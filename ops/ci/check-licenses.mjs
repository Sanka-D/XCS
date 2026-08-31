import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [reportPath, overridePath] = process.argv.slice(2)
if (reportPath === undefined || overridePath === undefined) {
  throw new Error(
    'Usage: node ops/ci/check-licenses.mjs <pnpm-license-report.json> <license-overrides.json>',
  )
}

const report = JSON.parse(await readFile(reportPath, 'utf8'))
if (report?.error !== undefined) {
  throw new Error(`pnpm license report failed: ${String(report.error.message ?? report.error)}`)
}
if (report === null || Array.isArray(report) || typeof report !== 'object') {
  throw new Error('pnpm license report must be a mapping')
}

const allowedLicenses = new Set([
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
])

function isAllowedExpression(expression) {
  const tokens = [...expression.matchAll(/\(|\)|\b(?:AND|OR|WITH)\b|[A-Za-z0-9.+-]+/gu)].map(
    ([token]) => token,
  )
  if (tokens.join('') !== expression.replaceAll(/\s/gu, '')) return false

  let position = 0
  const parsePrimary = () => {
    const token = tokens[position]
    if (token === '(') {
      position += 1
      const value = parseOr()
      if (tokens[position] !== ')') throw new Error('unbalanced license expression')
      position += 1
      return value
    }
    if (
      token === undefined ||
      token === ')' ||
      token === 'AND' ||
      token === 'OR' ||
      token === 'WITH'
    ) {
      throw new Error('invalid license expression')
    }
    position += 1
    return allowedLicenses.has(token)
  }
  const parseAnd = () => {
    let value = parsePrimary()
    while (tokens[position] === 'AND' || tokens[position] === 'WITH') {
      position += 1
      const right = parsePrimary()
      value = value && right
    }
    return value
  }
  const parseOr = () => {
    let value = parseAnd()
    while (tokens[position] === 'OR') {
      position += 1
      const right = parseAnd()
      value = value || right
    }
    return value
  }

  try {
    const value = parseOr()
    return position === tokens.length && value
  } catch {
    return false
  }
}

const overrideDocument = JSON.parse(await readFile(overridePath, 'utf8'))
if (
  overrideDocument === null ||
  Array.isArray(overrideDocument) ||
  typeof overrideDocument !== 'object' ||
  !Array.isArray(overrideDocument.overrides)
) {
  throw new Error('License override file must contain an overrides array')
}
const unknownOverrideFields = Object.keys(overrideDocument).filter((key) => key !== 'overrides')
if (unknownOverrideFields.length > 0) {
  throw new Error(`Unknown license override fields: ${unknownOverrideFields.join(', ')}`)
}

const overrides = new Map()
for (const [index, override] of overrideDocument.overrides.entries()) {
  const label = `overrides[${index}]`
  if (override === null || Array.isArray(override) || typeof override !== 'object') {
    throw new Error(`${label} must be a mapping`)
  }
  const allowedFields = new Set([
    'package',
    'version',
    'reportedLicense',
    'reviewedLicense',
    'licenseFile',
    'licenseSha256',
    'rationale',
  ])
  const unknownFields = Object.keys(override).filter((key) => !allowedFields.has(key))
  if (unknownFields.length > 0) {
    throw new Error(`${label} has unknown fields: ${unknownFields.join(', ')}`)
  }
  for (const field of ['package', 'version', 'reportedLicense', 'reviewedLicense', 'licenseFile']) {
    if (typeof override[field] !== 'string' || override[field].trim() === '') {
      throw new Error(`${label}.${field} must be a non-empty string`)
    }
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(override.licenseFile)) {
    throw new Error(`${label}.licenseFile must be a file name without a path`)
  }
  if (!/^[0-9a-f]{64}$/u.test(override.licenseSha256)) {
    throw new Error(`${label}.licenseSha256 must be a lowercase SHA-256 digest`)
  }
  if (typeof override.rationale !== 'string' || override.rationale.trim().length < 20) {
    throw new Error(`${label}.rationale must explain the review in at least 20 characters`)
  }
  if (!isAllowedExpression(override.reviewedLicense)) {
    throw new Error(`${label}.reviewedLicense is not in the approved license policy`)
  }

  const key = `${override.package}@${override.version}`
  if (overrides.has(key)) throw new Error(`Duplicate license override for ${key}`)
  overrides.set(key, override)
}

const observed = new Set()
const failures = []
const usedOverrides = new Set()

for (const [reportedLicense, packages] of Object.entries(report)) {
  observed.add(reportedLicense.trim())
  if (isAllowedExpression(reportedLicense)) continue
  if (!Array.isArray(packages) || packages.length === 0) {
    failures.push(`${reportedLicense}: report entry must contain packages`)
    continue
  }

  for (const packageEntry of packages) {
    if (!Array.isArray(packageEntry?.paths) || packageEntry.paths.length === 0) {
      failures.push(`${reportedLicense}: package entry has no installed path`)
      continue
    }
    for (const packagePath of packageEntry.paths) {
      try {
        const manifest = JSON.parse(await readFile(resolve(packagePath, 'package.json'), 'utf8'))
        const key = `${manifest.name}@${manifest.version}`
        if (
          manifest.name !== packageEntry.name ||
          !Array.isArray(packageEntry.versions) ||
          !packageEntry.versions.includes(manifest.version)
        ) {
          failures.push(`${key}: installed manifest does not match the pnpm license report`)
          continue
        }
        const override = overrides.get(key)
        if (override === undefined || override.reportedLicense !== reportedLicense) {
          failures.push(`${key}: denied or unknown license ${reportedLicense}`)
          continue
        }

        const license = await readFile(resolve(packagePath, override.licenseFile))
        const digest = createHash('sha256').update(license).digest('hex')
        if (digest !== override.licenseSha256) {
          failures.push(`${key}: reviewed license file digest changed`)
          continue
        }
        usedOverrides.add(key)
      } catch (error) {
        failures.push(
          `${String(packageEntry?.name ?? 'unknown package')}: could not validate license override (${String(error)})`,
        )
      }
    }
  }
}

if (observed.size === 0) throw new Error('No production dependency license was detected')
for (const key of overrides.keys()) {
  if (!usedOverrides.has(key)) failures.push(`${key}: license override is stale or unused`)
}
if (failures.length > 0) throw new Error(failures.sort().join('\n'))

process.stdout.write(
  `Validated ${observed.size} production dependency license expression(s) and ${usedOverrides.size} reviewed override(s).\n`,
)
