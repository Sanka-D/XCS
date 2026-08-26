import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_FORMAT_VERSION = 1
const EXPECTED_PROTOCOL_VERSION = '0.1'

export const CONFORMANCE_HANDLER_FILES = {
  canonicalization: 'canonicalization.json',
  'schema-validation': 'schema-validation.json',
  'schema-resolution': 'schema-resolution.json',
  'ripple-time': 'ripple-time.json',
  'lifecycle-state': 'lifecycle-state.json',
  'schema-uid': 'schema-uid.json',
  claims: 'claims.json',
  'payload-integrity': 'payload-integrity.json',
  'payload-retrieval': 'payload-retrieval.json',
  'payload-validation': 'payload-validation.json',
} as const

export type ConformanceHandler = keyof typeof CONFORMANCE_HANDLER_FILES

export interface ConformanceManifestEntry {
  file: string
  handler: ConformanceHandler
}

export interface ConformanceManifest {
  formatVersion: number
  protocolVersion: string
  revision: number
  files: ConformanceManifestEntry[]
}

export interface LoadedConformanceFile extends ConformanceManifestEntry {
  data: Record<string, unknown>
}

export interface LoadedConformanceSuite {
  manifest: ConformanceManifest
  files: LoadedConformanceFile[]
}

export const DEFAULT_CONFORMANCE_DIRECTORY = fileURLToPath(
  new URL('../../../conformance/v0.1/', import.meta.url),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`cannot read conformance JSON ${path}`, { cause: error })
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${context} contains unknown or missing properties`)
  }
}

function parseManifest(value: unknown): ConformanceManifest {
  if (!isRecord(value)) {
    throw new Error('conformance manifest must be an object')
  }
  requireExactKeys(value, ['formatVersion', 'protocolVersion', 'revision', 'files'], 'manifest')
  if (value.formatVersion !== EXPECTED_FORMAT_VERSION) {
    throw new Error(`unknown conformance manifest formatVersion: ${String(value.formatVersion)}`)
  }
  if (value.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
    throw new Error(`unknown conformance protocolVersion: ${String(value.protocolVersion)}`)
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    throw new Error('conformance manifest revision must be a positive safe integer')
  }
  if (!Array.isArray(value.files)) {
    throw new Error('conformance manifest files must be an array')
  }

  const seenFiles = new Set<string>()
  const seenHandlers = new Set<ConformanceHandler>()
  const files = value.files.map((entry, index): ConformanceManifestEntry => {
    if (!isRecord(entry)) {
      throw new Error(`manifest.files[${index}] must be an object`)
    }
    requireExactKeys(entry, ['file', 'handler'], `manifest.files[${index}]`)
    if (typeof entry.file !== 'string') {
      throw new Error(`manifest.files[${index}].file must be a string`)
    }
    if (
      typeof entry.handler !== 'string' ||
      !Object.hasOwn(CONFORMANCE_HANDLER_FILES, entry.handler)
    ) {
      throw new Error(`unknown conformance handler: ${String(entry.handler)}`)
    }

    const handler = entry.handler as ConformanceHandler
    if (entry.file !== CONFORMANCE_HANDLER_FILES[handler]) {
      throw new Error(`unknown conformance file for ${handler}: ${entry.file}`)
    }
    if (seenFiles.has(entry.file)) {
      throw new Error(`duplicate conformance file: ${entry.file}`)
    }
    if (seenHandlers.has(handler)) {
      throw new Error(`duplicate conformance handler: ${handler}`)
    }
    seenFiles.add(entry.file)
    seenHandlers.add(handler)
    return { file: entry.file, handler }
  })

  for (const handler of Object.keys(CONFORMANCE_HANDLER_FILES) as ConformanceHandler[]) {
    if (!seenHandlers.has(handler)) {
      throw new Error(`missing conformance handler: ${handler}`)
    }
  }

  return {
    formatVersion: EXPECTED_FORMAT_VERSION,
    protocolVersion: EXPECTED_PROTOCOL_VERSION,
    revision: value.revision as number,
    files,
  }
}

export function loadConformanceSuite(
  directory = DEFAULT_CONFORMANCE_DIRECTORY,
): LoadedConformanceSuite {
  const manifest = parseManifest(readJson(join(directory, 'manifest.json')))
  const declaredFiles = manifest.files.map(({ file }) => file).sort()
  const actualFiles = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'manifest.json',
    )
    .map(({ name }) => name)
    .sort()

  if (
    actualFiles.length !== declaredFiles.length ||
    actualFiles.some((file, index) => file !== declaredFiles[index])
  ) {
    const undeclared = actualFiles.filter((file) => !declaredFiles.includes(file))
    const missing = declaredFiles.filter((file) => !actualFiles.includes(file))
    throw new Error(
      `conformance file inventory mismatch (undeclared: ${undeclared.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`,
    )
  }

  const caseIds = new Set<string>()
  const files = manifest.files.map((entry): LoadedConformanceFile => {
    const data = readJson(join(directory, entry.file))
    if (!isRecord(data)) {
      throw new Error(`${entry.file} must contain an object`)
    }
    if (data.version !== manifest.protocolVersion) {
      throw new Error(`${entry.file} has unknown vector version: ${String(data.version)}`)
    }
    if (!Array.isArray(data.cases) || data.cases.length === 0) {
      throw new Error(`${entry.file} must contain at least one case`)
    }
    for (const [index, testCase] of data.cases.entries()) {
      if (!isRecord(testCase) || typeof testCase.id !== 'string' || testCase.id.trim() === '') {
        throw new Error(`${entry.file} case ${index} must have a non-empty id`)
      }
      if (caseIds.has(testCase.id)) {
        throw new Error(`duplicate conformance case id: ${testCase.id}`)
      }
      caseIds.add(testCase.id)
    }
    return { ...entry, data }
  })

  return { manifest, files }
}
