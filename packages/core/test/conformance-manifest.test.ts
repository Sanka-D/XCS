import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_CONFORMANCE_DIRECTORY, loadConformanceSuite } from './conformance-manifest.js'

const temporaryDirectories: string[] = []

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'xcs-conformance-ts-'))
  temporaryDirectories.push(directory)
  cpSync(DEFAULT_CONFORMANCE_DIRECTORY, directory, { recursive: true })
  return directory
}

function readObject(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function writeObject(path: string, value: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function manifestFiles(manifest: Record<string, unknown>): Array<Record<string, unknown>> {
  return manifest.files as Array<Record<string, unknown>>
}

function vectorCases(vector: Record<string, unknown>): Array<Record<string, unknown>> {
  return vector.cases as Array<Record<string, unknown>>
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('conformance manifest loader', () => {
  it.each([
    ['formatVersion', 2, /unknown conformance manifest formatVersion/],
    ['protocolVersion', '0.2', /unknown conformance protocolVersion/],
  ] as const)('rejects an unknown %s', (property, value, expected) => {
    const directory = fixtureDirectory()
    const path = join(directory, 'manifest.json')
    const manifest = readObject(path)
    manifest[property] = value
    writeObject(path, manifest)

    expect(() => loadConformanceSuite(directory)).toThrow(expected)
  })

  it('rejects an unknown handler', () => {
    const directory = fixtureDirectory()
    const path = join(directory, 'manifest.json')
    const manifest = readObject(path)
    manifestFiles(manifest)[0]!.handler = 'future-handler'
    writeObject(path, manifest)

    expect(() => loadConformanceSuite(directory)).toThrow(/unknown conformance handler/)
  })

  it('rejects an unknown file for a known handler', () => {
    const directory = fixtureDirectory()
    const path = join(directory, 'manifest.json')
    const manifest = readObject(path)
    manifestFiles(manifest)[0]!.file = 'renamed.json'
    writeObject(path, manifest)

    expect(() => loadConformanceSuite(directory)).toThrow(/unknown conformance file/)
  })

  it('rejects a missing handler even when its vector file is also absent', () => {
    const directory = fixtureDirectory()
    const path = join(directory, 'manifest.json')
    const manifest = readObject(path)
    manifest.files = manifestFiles(manifest).filter(({ handler }) => handler !== 'canonicalization')
    writeObject(path, manifest)
    rmSync(join(directory, 'canonicalization.json'))

    expect(() => loadConformanceSuite(directory)).toThrow(/missing conformance handler/)
  })

  it('rejects missing and undeclared JSON files', () => {
    const missingDirectory = fixtureDirectory()
    rmSync(join(missingDirectory, 'canonicalization.json'))
    expect(() => loadConformanceSuite(missingDirectory)).toThrow(/missing: canonicalization.json/)

    const additionalDirectory = fixtureDirectory()
    writeFileSync(join(additionalDirectory, 'future.json'), '{}\n')
    expect(() => loadConformanceSuite(additionalDirectory)).toThrow(/undeclared: future.json/)
  })

  it('rejects an unknown vector version', () => {
    const directory = fixtureDirectory()
    const path = join(directory, 'claims.json')
    const vector = readObject(path)
    vector.version = '0.2'
    writeObject(path, vector)

    expect(() => loadConformanceSuite(directory)).toThrow(/unknown vector version/)
  })

  it('requires stable, globally unique case IDs', () => {
    const emptyDirectory = fixtureDirectory()
    const claimsPath = join(emptyDirectory, 'claims.json')
    const claims = readObject(claimsPath)
    vectorCases(claims)[0]!.id = ''
    writeObject(claimsPath, claims)
    expect(() => loadConformanceSuite(emptyDirectory)).toThrow(/non-empty id/)

    const duplicateDirectory = fixtureDirectory()
    const payloadPath = join(duplicateDirectory, 'payload-integrity.json')
    const payload = readObject(payloadPath)
    vectorCases(payload)[0]!.id = 'claims.all-supported-types'
    writeObject(payloadPath, payload)
    expect(() => loadConformanceSuite(duplicateDirectory)).toThrow(
      /duplicate conformance case id: claims.all-supported-types/,
    )
  })
})
