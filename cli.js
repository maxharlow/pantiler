import Process from 'process'
import Yargs from 'yargs'
import FSExtra from 'fs-extra'
import Yaml from 'yaml'
import pantiler from './pantiler.js'

function alert(message, source, section) {
    if (source && section) console.error(`  ${message}: ${section}`)
    else if (source) console.error(`${message}: ${source}...`)
    else console.error(message)
}

async function setup() {
    const instructions = Yargs(Process.argv.slice(2))
        .usage('Usage: pantiler <tilefile> <directory>')
        .wrap(null)
        .option('c', { alias: 'clear-cache', type: 'boolean', default: false, describe: 'Remove the cache after completing' })
        .help('?').alias('?', 'help')
        .version().alias('v', 'version')
        .demandCommand(2, '')
    try {
        const {
            _: [tilefileName, directory],
            clearCache
        } = instructions.argv
        const tilefile = await FSExtra.readFile(tilefileName, 'utf8')
        const tiledata = Yaml.parse(tilefile)
        await pantiler(directory, '.pantiler-cache', clearCache, alert)(tiledata)
    }
    catch (e) {
        if (e.constructor.name === 'ZodError') {
            console.error('tilefile is not valid:')
            e.errors.forEach(error => {
                const path = error.path.reduce((a, element, i) => {
                    if (typeof element === 'number') return `${a}[${element}]`
                    if (i === 0) return element
                    return `${a}.${element}`
                }, '')
                console.error(`  ${path}${path ? ': ' : ''}${error.message.toLowerCase()}`)
            })
        }
        else console.error(e.message)
        Process.exit(1)
    }
}

setup()
