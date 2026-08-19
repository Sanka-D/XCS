import { readFile } from 'node:fs/promises'

import { parseJsonStrict, type JsonValue } from '@xcs-protocol/core'

import { CliError } from './errors.js'

export interface CliIo {
  readonly stdinIsTerminal: boolean
  readStdin(): Promise<string>
  readTextFile(path: string): Promise<string>
  writeStdout(value: string): void
  writeStderr(value: string): void
}

export const processIo: CliIo = {
  stdinIsTerminal: Boolean(process.stdin.isTTY),
  async readStdin() {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    }
    return Buffer.concat(chunks).toString('utf8')
  },
  readTextFile: (path) => readFile(path, 'utf8'),
  writeStdout: (value) => process.stdout.write(value),
  writeStderr: (value) => process.stderr.write(value),
}

export async function readJsonFile(io: CliIo, path: string): Promise<JsonValue> {
  let contents: string
  try {
    contents = await io.readTextFile(path)
  } catch (error) {
    throw new CliError('XCS_CLI_FILE_READ', `Cannot read ${path}.`, 2, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  return parseJsonStrict(contents)
}

export function writeJson(io: CliIo, value: unknown): void {
  io.writeStdout(`${JSON.stringify(value, null, 2)}\n`)
}
