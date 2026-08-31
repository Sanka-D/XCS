import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { processIo } from '../src/io.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('process IO', () => {
  it('rejects invalid UTF-8 instead of hashing replacement characters as profile bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xcs-cli-io-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'invalid.json')
    await writeFile(path, Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d]))

    await expect(processIo.readTextFile(path)).rejects.toThrow()
  })

  it('preserves a UTF-8 BOM so strict JSON parsing cannot silently hash different bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xcs-cli-io-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'bom.json')
    await writeFile(path, Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))

    await expect(processIo.readTextFile(path)).resolves.toBe('\uFEFF{}')
  })
})
