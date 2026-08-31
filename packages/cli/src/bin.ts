import { runCli } from './index.js'

const exitCode = await runCli(process.argv)
process.exitCode = exitCode
