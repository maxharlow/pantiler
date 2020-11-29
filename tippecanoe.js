import Util from 'util'
import Path from 'path'
import URL from 'url'
import Process from 'process'
import ChildProcess from 'child_process'
import Readline from 'readline'
import OS from 'os'
import Stream from 'stream'
import Tar from 'tar'
import Axios from 'axios'

// MacOS versions from: https://en.wikipedia.org/wiki/Darwin_%28operating_system%29#Release_history
// Homebrew formula: https://github.com/Homebrew/homebrew-core/blob/master/Formula/tippecanoe.rb
// Linuxbrew formula: https://github.com/Homebrew/linuxbrew-core/blob/master/Formula/tippecanoe.rb

const binaries = [
    {
        platform: 'darwin',
        release: '17',
        architecture: 'x64',
        version: '1.36.0',
        location: 'https://homebrew.bintray.com/bottles/tippecanoe-1.36.0.high_sierra.bottle.tar.gz'
    },
    {
        platform: 'darwin',
        release: '18',
        architecture: 'x64',
        version: '1.36.0',
        location: 'https://homebrew.bintray.com/bottles/tippecanoe-1.36.0.mojave.bottle.tar.gz'
    },
    {
        platform: 'darwin',
        release: '19',
        architecture: 'x64',
        version: '1.36.0',
        location: 'https://homebrew.bintray.com/bottles/tippecanoe-1.36.0.catalina.bottle.tar.gz'
    },
    {
        platform: 'darwin',
        release: '20',
        architecture: 'x64',
        version: '1.36.0',
        location: 'https://homebrew.bintray.com/bottles/tippecanoe-1.36.0.big_sur.bottle.tar.gz'
    },
    {
        platform: 'linux',
        architecture: 'x64',
        version: '1.36.0',
        location: 'https://linuxbrew.bintray.com/bottles/tippecanoe-1.36.0.x86_64_linux.bottle.tar.gz',
    }
]

async function install() {
    const platform = OS.platform()
    const release = OS.release().split('.')[0]
    const architecture = OS.arch()
    const binary = binaries.find(binary => {
        return binary.platform === platform
            && (binary.release && binary.release === release)
            && binary.architecture === architecture
    })
    if (!binary) {
        console.error('no Tippecanoe binary suitable for this machine could not be downloaded -- please ensure it is installed locally')
        return
    }
    const response = await Axios({
        url: binary.location,
        responseType: 'stream'
    })
    const bin = Path.resolve(Path.dirname(URL.fileURLToPath(import.meta.url)), 'node_modules', '.bin')
    const extractor = Tar.extract({
        cwd: bin,
        filter: path => path.endsWith('bin/tippecanoe'),
        strip: 3
    })
    await Util.promisify(Stream.pipeline)(response.data, extractor)
    console.error(`installed Tippecanoe v${binary.version} to ${bin.toString()}`)
}

async function run(options, alert = () => {}) {
    const bin = Path.resolve(Path.dirname(URL.fileURLToPath(import.meta.url)), 'node_modules', '.bin')
    const env = {
        ...Process.env,
        PATH: `${bin}:${Process.env.PATH}`
    }
    try {
        await Util.promisify(ChildProcess.execFile)('tippecanoe', ['-v'], { env })
    }
    catch (e) {
        throw new Error('tippecanoe could not run')
    }
    let error = false
    const logger = stream => {
        const reader = Readline.createInterface({
            input: stream,
            terminal: true
        })
        reader.on('line', text => {
            if (text.startsWith('Usage')) error = true
            if (error) return
            const message = text.replace(':', '').trim().toLowerCase()
            if (message) alert(message)
        })
    }
    const args = options.map(option => `--${option}`)
    const process = ChildProcess.spawn('tippecanoe', args, { env })
    return new Promise((resolve, reject) => {
        logger(process.stdout)
        logger(process.stderr)
        process.on('close', code => code === 0 ? resolve() : reject(new Error('tippecanoe failure')))
    })
}

export { install }
export default run
