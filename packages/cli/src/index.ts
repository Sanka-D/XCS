import { XcsError } from '@xcs-protocol/core'
import { XcsSdkError } from '@xcs-protocol/sdk'
import { CommanderError } from 'commander'
import { Client } from 'xrpl'

import { CliError, type CliExitCode } from './errors.js'
import { processIo, type CliIo } from './io.js'
import { createProgram, type CliDependencies } from './program.js'

export { CliError } from './errors.js'
export type { CliExitCode } from './errors.js'
export type { CliIo } from './io.js'
export { CompositeOperationJournal, JsonLinesOperationJournal } from './journal.js'
export { createProgram } from './program.js'
export type { CliDependencies } from './program.js'

export async function runCli(
  argv: readonly string[],
  dependencies: Partial<CliDependencies> & { readonly io?: CliIo } = {},
): Promise<CliExitCode> {
  const io = dependencies.io ?? processIo
  const resolved: CliDependencies = {
    io,
    createClient: dependencies.createClient ?? ((url) => new Client(url)),
    fetch: dependencies.fetch ?? globalThis.fetch,
  }
  const program = createProgram(resolved)

  try {
    await program.parseAsync([...argv], { from: 'node' })
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return 0
      writeError(io, 'XCS_CLI_USAGE', error.message)
      return 2
    }
    if (error instanceof CliError) {
      writeError(io, error.code, error.message, error.details)
      return error.exitCode
    }
    if (error instanceof XcsSdkError) {
      writeError(io, error.code, error.message, error.details)
      return 2
    }
    if (error instanceof XcsError) {
      writeError(io, error.code, error.message, {
        ...(error.path === undefined ? {} : { path: error.path }),
        ...(error.details ?? {}),
      })
      return 2
    }

    writeError(io, 'XCS_CLI_INTERNAL', error instanceof Error ? error.message : String(error))
    return 3
  }
}

function writeError(
  io: CliIo,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): void {
  io.writeStderr(
    `${JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } })}\n`,
  )
}
