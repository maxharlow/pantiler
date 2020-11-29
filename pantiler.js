import Util from 'util'
import FSExtra from 'fs-extra'
import Zod from 'zod'
import Scramjet from 'scramjet'
import Axios from 'axios'
import Unzipper from 'unzipper'
import Fontnik from 'fontnik'
import Gdal from 'gdal-next'
import Spritezero from '@mapbox/spritezero'
import Tippecanoe from './tippecanoe.js'

function setup(directory, cache = '.pantiler-cache', clearCache = false, alert = () => {}) {

    function validate(tiledata) {
        const inputSchema = Zod.object({
            name: Zod.string(),
            url: Zod.string().url().optional(), // otherwise use path
            path: Zod.string().optional(), // otherwise use url
            format: Zod.string().optional()
        })
        const schema = Zod.object({
            host: Zod.string().url(),
            zoomFrom: Zod.number().positive(),
            zoomTo: Zod.number().positive(),
            fonts: Zod.array(inputSchema).optional(),
            sprites: Zod.array(inputSchema).optional(),
            sources: Zod.array(Zod.object({
                name: Zod.string(),
                system: Zod.string(),
                fieldLongitude: Zod.string().optional(),
                fieldLatitude: Zod.string().optional(),
                inputs: Zod.array(inputSchema),
                outputs: Zod.array(Zod.object({
                    name: Zod.string(),
                    layer: Zod.string().optional(),
                    fields: Zod.object().optional(),
                    zoomMin: Zod.number().optional(),
                    zoomMax: Zod.number().optional()
                }))
            })),
            styling: Zod.object() // not attempting to validate this
        })
        schema.parse(tiledata)
    }

    async function englyph(fonts) {
        await fonts.reduce(async (a, font) => {
            await a
            alert({
                process: 'englyphing',
                input: font.name,
                message: 'in progress...'
            })
            const location = `${directory}/glyphs/${font.name}`
            await FSExtra.ensureDir(location)
            const data = font.path
                ? await FSExtra.readFile(font.path)
                : await (await Axios({ url: font.url, responseType: 'arraybuffer' })).data
            let ranges = []
            for (let i = 0; i < 65536; (i = i + 256)) {
                ranges.push({ start: i, end: Math.min(i + 255, 65535) })
            }
            const conversions = ranges.map(async range => {
                const result = await Util.promisify(Fontnik.range)({
                    font: data,
                    start: range.start,
                    end: range.end
                })
                return FSExtra.writeFile(`${location}/${range.start}-${range.end}.pbf`, result)
            })
            await Promise.all(conversions)
            alert({
                process: 'englyphing',
                input: font.name,
                message: 'done'
            })
        }, Promise.resolve())
    }

    async function ensprite(sprites) {
        const ratios = [1, 2]
        await ratios.reduce(async (a, ratio) => {
            await a
            alert({
                process: 'enspriting',
                input: `@${ratio}x`,
                message: 'in progress...'
            })
            const ratioAt =  ratio > 1 ? `@${ratio}x` : ''
            const images = sprites.map(async sprite => {
                const data = sprite.path
                    ? await FSExtra.readFile(sprite.path)
                    : await (await Axios({ url: sprite.url, responseType: 'arraybuffer' })).data
                return {
                    id: sprite.name,
                    svg: data
                }
            })
            const config = {
                imgs: await Promise.all(images),
                pixelRatio: ratio
            }
            const manifest = await Util.promisify(Spritezero.generateLayout)({ ...config, format: true })
            await FSExtra.writeJson(`${directory}/sprites${ratioAt}.json`, manifest)
            const layout = await Util.promisify(Spritezero.generateLayout)({ ...config, format: false })
            const image = await Util.promisify(Spritezero.generateImage)(layout)
            await FSExtra.writeFile(`${directory}/sprites${ratioAt}.png`, image)
            alert({
                process: 'enspriting',
                input: `@${ratio}x`,
                message: 'done'
            })
        }, Promise.resolve())
    }

    async function fetch(name, inputs) {
        const downloads = inputs.map(async input => {
            const inputSpecifier = inputs.length > 1 ? `-${input.name}` : ''
            if (!input.url && !input.path) throw new Error(`${name}${inputSpecifier}: need to specify either url or path`)
            const extension = input.format || (input.path || input.url).split('.').pop()
            const file = `${cache}/${name}${inputSpecifier}.${extension}`
            const fileExists = await FSExtra.pathExists(file)
            if (fileExists) {
                alert({
                    process: 'fetching',
                    input: name + inputSpecifier,
                    message: 'using cache'
                })
                return { name: input.name, path: file }
            }
            if (input.path) {
                await FSExtra.ensureSymlink(input.path, file)
                alert({
                    process: 'fetching',
                    input: name + inputSpecifier,
                    message: 'linked'
                })
                return { name: input.name, path: file }
            }
            alert({
                process: 'fetching',
                input: name + inputSpecifier,
                message: 'in progress...'
            })
            const response = await Axios({
                url: input.url,
                responseType: 'stream'
            })
            const writer = FSExtra.createWriteStream(file)
            response.data.pipe(writer)
            await new Promise((resolve, reject) => {
                writer.on('error', reject)
                writer.on('close', resolve)
            })
            alert({
                process: 'fetching',
                input: name + inputSpecifier,
                message: 'done'
            })
            return { name: input.name, path: file }
        })
        return Promise.all(downloads)
    }

    async function extract(name, archives) {
        const extractions = archives.map(async archive => {
            if (!archive.path.endsWith('zip')) {
                return archive // no extraction needed
            }
            const archiveSpecifier = archives.length > 1 ? `-${archive.name}` : ''
            const zip = await Unzipper.Open.file(archive.path)
            const entries = zip.files.filter(entry => entry.type === 'File' && !entry.path.match(/\.(pdf|txt)$/))
            const extractions = entries.map(async entry => {
                const extension = entry.path.split('.').pop()
                const file = `${cache}/${name}${archiveSpecifier}.${extension}`
                const fileExists = await FSExtra.pathExists(file)
                if (fileExists) {
                    alert({
                        process: 'extracting',
                        input: name + archiveSpecifier,
                        ...(entries.length > 1 ? { output: name + (entries.length > 1 ? `/${extension}` : '') } : {}),
                        message: 'using cache'
                    })
                    return { name: archive.name, path: file }
                }
                alert({
                    process: 'extracting',
                    input: name + archiveSpecifier,
                    ...(entries.length > 1 ? { output: name + (entries.length > 1 ? `/${extension}` : '') } : {}),
                    message: 'in progress...'
                })
                const writer = entry.stream().pipe(FSExtra.createWriteStream(file))
                await new Promise((resolve, reject) => {
                    writer.on('error', reject)
                    writer.on('finish', resolve)
                })
                alert({
                    process: 'extracting',
                    input: name + archiveSpecifier,
                    ...(entries.length > 1 ? { output: name + (entries.length > 1 ? `/${extension}` : '') } : {}),
                    message: 'done'
                })
                return { name: archive.name, path: file }
            })
            const extracted = await Promise.all(extractions)
            if (extracted.length === 1) return extracted[0]
            else if (extracted.find(file => file.path.endsWith('shp'))) return extracted.find(file => file.path.endsWith('shp'))
            else throw new Error(`${name}${archiveSpecifier}: archive has multiple files, unclear which to use`)
        })
        return Promise.all(extractions)
    }

    async function convert(name, system, fieldLongitude, fieldLatitude, inputs, outputs) {
        const reprojection = new Gdal.CoordinateTransformation(Gdal.SpatialReference.fromProj4(system), Gdal.SpatialReference.fromProj4('+init=epsg:4326'))
        return outputs.reduce(async (previousOutput, output) => {
            await previousOutput
            const outputSpecifier = outputs.length > 1 ? `-${output.name}` : ''
            const file = `${cache}/${name}${outputSpecifier}.geo.json`
            const fileExists = await FSExtra.pathExists(file)
            if (fileExists) {
                alert({
                    process: 'converting',
                    input: name,
                    ...(outputs.length > 1 || inputs.length > 1 ? { output: name + outputSpecifier } : {}),
                    message: 'using cache'
                })
                return
            }
            const outputData = Gdal.open(file, 'w', 'GeoJSON')
            const outputLayer = outputData.layers.create(`${name}${outputSpecifier}`, null, Gdal.wkbUnknown)
            const outputFieldDefinitions = Object.keys(output.fields || {}).map(key => {
                return new Gdal.FieldDefn(key, Gdal.OFTString)
            })
            outputLayer.fields.add(outputFieldDefinitions)
            inputs.forEach(input => {
                alert({
                    process: 'converting',
                    input: name + (inputs.length > 1 ? `-${input.name}` : ''),
                    ...(outputs.length > 1 || inputs.length > 1 ? { output: name + outputSpecifier } : {}),
                    message: 'in progress...'
                })
                const inputData = Gdal.open(input.path)
                const inputLayer = inputData.layers.get(output.layer || 0)
                inputLayer.features.forEach(feature => {
                    const outputFeature = new Gdal.Feature(outputLayer)
                    const outputFields = Object.entries(output.fields || {}).map(([key, value]) => {
                        try {
                            return [key, feature.fields.get(value)]
                        }
                        catch (e) {
                            return [key, null]
                        }
                    })
                    outputFeature.fields.set(Object.fromEntries(outputFields))
                    const outputGeometry = (fieldLongitude && fieldLatitude)
                        ? Gdal.Geometry.fromGeoJson({ type: 'Point', coordinates: [Number(feature.fields.get(fieldLongitude)), Number(feature.fields.get(fieldLatitude))] })
                        : feature.getGeometry()
                    outputGeometry.transform(reprojection) // mutates in-place
                    outputFeature.setGeometry(outputGeometry)
                    outputLayer.features.add(outputFeature)
                })
                alert({
                    process: 'converting',
                    input: name + (inputs.length > 1 ? `-${input.name}` : ''),
                    ...(outputs.length > 1 || inputs.length > 1 ? { output: name + outputSpecifier } : {}),
                    message: 'done'
                })
            })
            outputData.close()
            if (output.zoomMin || output.zoomMax) {
                const collection = await FSExtra.readJson(file)
                const tippecanoe = {
                    ...(output.zoomMin ? { minzoom: output.zoomMin } : {}),
                    ...(output.zoomMax ? { maxzoom: output.zoomMax } : {})
                }
                const features = collection.features.map(feature => ({ ...feature, tippecanoe }))
                await FSExtra.writeJson(file, { ...collection, features })
            }
        }, Promise.resolve())
    }

    async function tile(sources, zoomFrom, zoomTo) {
        alert({ process: 'tiling', message: 'in progress...' })
        const sourcelist = sources.flatMap(source => {
            return source.outputs.map(output => {
                const outputSpecifier = source.outputs.length > 1 ? `-${output.name}` : ''
                return `named-layer=${output.name}:${cache}/${source.name}${outputSpecifier}.geo.json`
            })
        })
        const options = [
            `minimum-zoom=${zoomFrom}`,
            `maximum-zoom=${zoomTo}`,
            `output-to-directory=${directory}`,
            'generate-ids',
            'no-tile-compression',
            ...sourcelist
        ]
        await Tippecanoe(options, message => {
            alert({ process: 'tiling', message })
        })
        const metadata = await FSExtra.readJson(`${directory}/metadata.json`)
        await FSExtra.remove(`${directory}/metadata.json`)
        alert({ process: 'tiling', message: 'done' })
        return metadata
    }

    async function style(metadata, styling, host, hasFonts, hasSprites) {
        const styles = {
            version: 8,
            metadata: {
                date: new Date().toISOString()
            },
            ...(hasFonts ? { glyphs: `${host}/glyphs/{fontstack}/{range}.pbf` } : {}),
            ...(hasSprites ? { sprite: `${host}/sprites` } : {}),
            sources: {
                primary: {
                    type: 'vector',
                    tiles: [`${host}/{z}/{x}/{y}.pbf`],
                    bounds: metadata.bounds.split(',').map(Number),
                    minzoom: Number(metadata.minzoom),
                    maxzoom: Number(metadata.maxzoom)
                }
            },
            ...styling
        }
        alert({ process: 'styling', message: 'done' })
        return FSExtra.writeJson(`${directory}/style.json`, styles)
    }

    async function cleanup(clearCache) {
        if (!clearCache) return
        await FSExtra.remove(cache)
        alert({ process: 'cleaning up', message: 'done' })
    }

    async function run(tiledata) {
        const directoryExists = await FSExtra.exists(directory)
        if (directoryExists) throw new Error('directory already exists!')
        validate(tiledata)
        await FSExtra.ensureDir(directory)
        await FSExtra.ensureDir(cache)
        if (tiledata.fonts) await englyph(tiledata.fonts)
        if (tiledata.sprites) await ensprite(tiledata.sprites)
        await Scramjet.DataStream.from(tiledata.sources).each(async source => {
            const archives = await fetch(source.name, source.inputs)
            const inputs = await extract(source.name, archives)
            return convert(source.name, source.system, source.fieldLongitude, source.fieldLatitude, inputs, source.outputs)
        }).whenEnd()
        const metadata = await tile(tiledata.sources, tiledata.zoomFrom, tiledata.zoomTo)
        await style(metadata, tiledata.styling, tiledata.host, tiledata.fonts?.length > 0, tiledata.sprites?.length > 0)
        await cleanup(clearCache)
        alert({ message: 'done' })
    }

    return run

}

export default setup
