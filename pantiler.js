import Util from 'util'
import ChildProcess from 'child_process'
import FSExtra from 'fs-extra'
import Zod from 'zod'
import Axios from 'axios'
import Unzipper from 'unzipper'
import Fontnik from 'fontnik'
import Gdal from 'gdal-next'

function setup(directory, cache = '.pantiler-cache', clearCache = false, alert = () => {}) {

    function validate(tiledata) {
        const inputSchema = Zod.object({
            name: Zod.string(),
            url: Zod.string().url().optional(), // otherwise use path
            path: Zod.string().optional(), // otherwise use url
            format: Zod.string().optional() // if the url/path doesn't have an extension, give it here
        })
        const schema = Zod.object({
            host: Zod.string().url(),
            zoomFrom: Zod.number().positive(),
            zoomTo: Zod.number().positive(),
            fonts: Zod.array(inputSchema),
            sources: Zod.array(Zod.object({
                name: Zod.string(),
                system: Zod.string(),
                fieldLongitude: Zod.string().optional(), // only needed for CSV point inputs
                fieldLatitude: Zod.string().optional(), // only needed for CSV point inputs
                inputs: Zod.array(inputSchema),
                outputs: Zod.array(Zod.object({
                    name: Zod.string(),
                    layer: Zod.string(),
                    fields: Zod.object(),
                    additional: Zod.object().optional() // arbitrary extra data which can be included
                }))
            })),
            styling: Zod.object() // not attempting to validate this
        })
        schema.parse(tiledata)
    }

    async function englyph(fonts) {
        alert('Generating glyphs...')
        await fonts.reduce(async (previousFont, font) => {
            await previousFont
            const location = `${directory}/glyphs/${font.name}`
            await FSExtra.ensureDir(location)
            const response = await Axios({
                url: font.url,
                responseType: 'arraybuffer'
            })
            let ranges = []
            for (let i = 0; i < 65536; (i = i + 256)) {
                ranges.push({ start: i, end: Math.min(i + 255, 65535) })
            }
            const conversions = ranges.map(async range => {
                const result = await Util.promisify(Fontnik.range)({
                    font: response.data,
                    start: range.start,
                    end: range.end
                })
                await FSExtra.writeFile(`${location}/${range.start}-${range.end}.pbf`, result)
            })
            await Promise.all(conversions)
            alert('Done', 'glyphs', font.name)
        }, Promise.resolve())
    }

    async function fetch(name, inputs) {
        alert('Fetching', name)
        const downloads = inputs.map(async input => {
            const inputSpecifier = inputs.length > 1 ? `-${input.name}` : ''
            if (!input.url && !input.path) throw new Error(`${name}${inputSpecifier}: need to specify either url or path`)
            const extension = input.format || (input.path || input.url).split('.').pop()
            const file = `${cache}/${name}${inputSpecifier}.${extension}`
            const fileExists = await FSExtra.pathExists(file)
            if (fileExists) {
                alert('Using cache', name, input.name)
                return { name: input.name, path: file }
            }
            if (input.path) {
                await FSExtra.ensureSymlink(input.path, file)
                alert('Done', name, input.name)
                return { name: input.name, path: file }
            }
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
            alert('Done', name, input.name)
            return { name: input.name, path: file }
        })
        return Promise.all(downloads)
    }

    async function extract(name, archives) {
        alert('Extracting', name)
        const extractions = archives.map(async archive => {
            if (!archive.path.endsWith('zip')) {
                alert('Using cache', name, archive.name)
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
                    alert('Using cache', name, archive.name + (entries.length > 1 ? `/${extension}` : ''))
                    return { name: archive.name, path: file }
                }
                const writer = entry.stream().pipe(FSExtra.createWriteStream(file))
                await new Promise((resolve, reject) => {
                    writer.on('error', reject)
                    writer.on('finish', resolve)
                })
                alert('Done', name, archive.name)
                return { name: archive.name, path: file }
            })
            const extracted = await Promise.all(extractions)
            if (extracted.length === 1) return extracted[0]
            else if (extracted.find(file => file.path.endsWith('shp'))) return extracted.find(file => file.path.endsWith('shp'))
            else throw new Error(`${name}${archiveSpecifier}: archive has multiple files, unclear which is main`)
        })
        return Promise.all(extractions)
    }

    async function convert(name, system, fieldLongitude, fieldLatitude, inputs, outputs) {
        alert('Converting', name)
        const reprojection = new Gdal.CoordinateTransformation(Gdal.SpatialReference.fromProj4(system), Gdal.SpatialReference.fromProj4('+init=epsg:4326'))
        return outputs.reduce(async (previousOutput, output) => {
            await previousOutput
            const outputSpecifier = outputs.length > 1 ? `-${output.name}` : ''
            const file = `${cache}/${name}${outputSpecifier}.geo.json`
            const fileExists = await FSExtra.pathExists(file)
            if (fileExists) {
                alert('Using cache', name, output.name)
                return
            }
            const outputData = Gdal.open(file, 'w', 'GeoJSON')
            const outputLayer = outputData.layers.create(`${name}${outputSpecifier}`, null, Gdal.wkbUnknown)
            const outputFieldDefinitions = Object.keys(output.fields).map(key => {
                return new Gdal.FieldDefn(key, Gdal.OFTString)
            })
            outputLayer.fields.add(outputFieldDefinitions)
            inputs.forEach(input => {
                const inputData = Gdal.open(input.path)
                const inputLayer = inputData.layers.get(output.layer)
                inputLayer.features.forEach(feature => {
                    const outputFeature = new Gdal.Feature(outputLayer)
                    const outputFields = Object.entries(output.fields).map(([key, value]) => {
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
            })
            outputData.close()
            if (output.additional) {
                const collection = await FSExtra.readJson(file)
                const features = collection.features.map(feature => ({ ...feature, ...output.additional }))
                await FSExtra.writeJson(file, { ...collection, features })
            }
            alert('Done', name, output.name)
        }, Promise.resolve())
    }

    async function tile(sources, zoomFrom, zoomTo) {
        alert('Tiling...')
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
        const args = options.map(x => `--${x}`).join(' ')
        const logs = await Util.promisify(ChildProcess.exec)(`tippecanoe ${args}`)
        if (logs.stderr) logs.stderr.trim().split('\n').forEach(message => {
            alert(message)
        })
        const metadata = await FSExtra.readJson(`${directory}/metadata.json`)
        await FSExtra.remove(`${directory}/metadata.json`)
        return metadata
    }

    async function style(metadata, styling, host) {
        alert('Styling...')
        const styles = {
            version: 8,
            metadata: {
                date: new Date().toISOString()
            },
            glyphs: `${host}/glyphs/{fontstack}/{range}.pbf`,
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
        return FSExtra.writeJson(`${directory}/style.json`, styles)
    }

    async function cleanup(clearCache) {
        if (!clearCache) return
        alert('Removing cache directory...')
        await FSExtra.remove(cache)
    }

    async function run(tiledata) {
        const directoryExists = await FSExtra.exists(directory)
        if (directoryExists) throw new Error('directory already exists!')
        validate(tiledata)
        await FSExtra.ensureDir(directory)
        await FSExtra.ensureDir(cache)
        await englyph(tiledata.fonts)
        await tiledata.sources.reduce(async (previous, source) => {
            await previous
            const archives = await fetch(source.name, source.inputs)
            const inputs = await extract(source.name, archives)
            return convert(source.name, source.system, source.fieldLongitude, source.fieldLatitude, inputs, source.outputs)
        }, Promise.resolve())
        const metadata = await tile(tiledata.sources, tiledata.zoomFrom, tiledata.zoomTo)
        await style(metadata, tiledata.styling, tiledata.host)
        await cleanup(clearCache)
        alert('Done!')
    }

    return run

}

export default setup
