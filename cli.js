import Process from 'process'
import Yargs from 'yargs'
import Chalk from 'chalk'
import FSExtra from 'fs-extra'
import Yaml from 'yaml'
import pantiler from './pantiler.js'

function alert() {
    let lines = {}
    return ({ process, input, output, message }) => {
        const key = [process, input, output].filter(x => x).join('-')
        const elements = [
            process && Chalk.blue(process),
            input && ` ${input}`,
            output && ` -> ${output}`,
            (process || input || output) && ': ',
            message === 'done' ? Chalk.green(message) : message === 'in progress...' ? Chalk.yellow(message) : Chalk.magenta(message)
        ]
        if (Object.values(lines).length > 0) Process.stderr.moveCursor(0, -Object.values(lines).length)
        lines[key] = elements.filter(x => x).join('')
        Object.values(lines).forEach(line => {
            Process.stderr.clearLine()
            Process.stderr.write(line + '\n')
        })
    }
}

async function setup() {
    const instructions = Yargs(Process.argv.slice(2))
        .usage('Usage: pantiler <tilefile> <directory>')
        .wrap(null)
        .option('c', { alias: 'clear-cache', type: 'boolean', default: false, describe: 'Remove the cache after completing' })
        .option('b', { alias: 'bounds', type: 'string', describe: 'A set of coordinates to clip the data with as minLong,minLat,maxLong,maxLat (using WGS84)' })
        .help('?').alias('?', 'help')
        .version().alias('v', 'version')
        .demandCommand(2, '')
    try {
        const {
            _: [tilefileName, directory],
            clearCache,
            bounds
        } = instructions.argv
        const tilefile = await FSExtra.readFile(tilefileName, 'utf8')
        const tiledata = Yaml.parse(tilefile)
        await pantiler(directory, '.pantiler-cache', clearCache, bounds?.split(',').map(Number), alert())(tiledata)
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
        else console.error(Chalk.red(e.message))
        Process.exit(1)
    }
}

setup()
