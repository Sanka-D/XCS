import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [reportPath, overridePath, acceptancePath] = process.argv.slice(2)
if (reportPath === undefined || overridePath === undefined || acceptancePath === undefined) {
  throw new Error(
    'Usage: node ops/ci/check-licenses.mjs <pnpm-license-report.json> <license-overrides.json> <license-acceptances.json>',
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
  '0BSD',
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

// Acceptances cover the other half of the problem. An override says "the
// reported license is wrong, the real one is X"; an acceptance says "the
// reported license really is non-standard, and here is the permission or the
// review that makes shipping it legitimate". Both pin the exact reviewed
// license text by digest, so an entry stops applying the moment upstream
// changes its terms.
const acceptanceDocument = JSON.parse(await readFile(acceptancePath, 'utf8'))
if (
  acceptanceDocument === null ||
  Array.isArray(acceptanceDocument) ||
  typeof acceptanceDocument !== 'object' ||
  !Array.isArray(acceptanceDocument.acceptances)
) {
  throw new Error('License acceptance file must contain an acceptances array')
}
const unknownAcceptanceFields = Object.keys(acceptanceDocument).filter(
  (key) => key !== 'acceptances',
)
if (unknownAcceptanceFields.length > 0) {
  throw new Error(`Unknown license acceptance fields: ${unknownAcceptanceFields.join(', ')}`)
}

const acceptanceBases = new Set(['granted-permission', 'reviewed-compliance'])
const acceptances = new Map()
for (const [index, acceptance] of acceptanceDocument.acceptances.entries()) {
  const label = `acceptances[${index}]`
  if (acceptance === null || Array.isArray(acceptance) || typeof acceptance !== 'object') {
    throw new Error(`${label} must be a mapping`)
  }
  const allowedFields = new Set([
    'package',
    'version',
    'reportedLicense',
    'licenseName',
    'licenseFile',
    'licenseSha256',
    'basis',
    'grantedBy',
    'grantedOn',
    'reviewedBy',
    'reviewedOn',
    'licenseReleaseDate',
    'attestation',
    'evidence',
    'rationale',
  ])
  const unknownFields = Object.keys(acceptance).filter((key) => !allowedFields.has(key))
  if (unknownFields.length > 0) {
    throw new Error(`${label} has unknown fields: ${unknownFields.join(', ')}`)
  }
  for (const field of [
    'package',
    'version',
    'reportedLicense',
    'licenseName',
    'licenseFile',
    'basis',
  ]) {
    if (typeof acceptance[field] !== 'string' || acceptance[field].trim() === '') {
      throw new Error(`${label}.${field} must be a non-empty string`)
    }
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(acceptance.licenseFile)) {
    throw new Error(`${label}.licenseFile must be a file name without a path`)
  }
  if (!/^[0-9a-f]{64}$/u.test(acceptance.licenseSha256)) {
    throw new Error(`${label}.licenseSha256 must be a lowercase SHA-256 digest`)
  }
  if (!acceptanceBases.has(acceptance.basis)) {
    throw new Error(`${label}.basis must be one of ${[...acceptanceBases].join(', ')}`)
  }
  for (const field of ['evidence', 'rationale']) {
    if (typeof acceptance[field] !== 'string' || acceptance[field].trim().length < 20) {
      throw new Error(`${label}.${field} must be recorded in at least 20 characters`)
    }
  }
  const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}(?:-\d{2})?$/u.test(value)
  // The two bases carry different facts, and each one refuses the other's
  // fields so that an entry cannot claim a permission it does not have, or
  // hide a missing grant behind a review field.
  const requiredByBasis =
    acceptance.basis === 'granted-permission'
      ? { people: ['grantedBy'], dates: ['grantedOn'], text: [] }
      : {
          people: ['reviewedBy'],
          dates: ['reviewedOn', 'licenseReleaseDate'],
          text: ['attestation'],
        }
  const forbiddenByBasis = [...allowedFields].filter(
    (field) =>
      [
        'grantedBy',
        'grantedOn',
        'reviewedBy',
        'reviewedOn',
        'licenseReleaseDate',
        'attestation',
      ].includes(field) &&
      !requiredByBasis.people.includes(field) &&
      !requiredByBasis.dates.includes(field) &&
      !requiredByBasis.text.includes(field),
  )
  for (const field of requiredByBasis.people) {
    if (typeof acceptance[field] !== 'string' || acceptance[field].trim().length < 3) {
      throw new Error(`${label}.${field} must name the person or organisation responsible`)
    }
  }
  for (const field of requiredByBasis.dates) {
    if (!isDate(acceptance[field])) {
      throw new Error(`${label}.${field} must be an ISO date (YYYY-MM or YYYY-MM-DD)`)
    }
  }
  for (const field of requiredByBasis.text) {
    if (typeof acceptance[field] !== 'string' || acceptance[field].trim().length < 20) {
      throw new Error(`${label}.${field} must state what was attested in at least 20 characters`)
    }
  }
  for (const field of forbiddenByBasis) {
    if (acceptance[field] !== undefined) {
      throw new Error(`${label}.${field} does not apply to a ${acceptance.basis} acceptance`)
    }
  }

  const key = `${acceptance.package}@${acceptance.version}`
  if (acceptances.has(key)) throw new Error(`Duplicate license acceptance for ${key}`)
  if (overrides.has(key)) {
    throw new Error(`${key} cannot have both a license override and a license acceptance`)
  }
  acceptances.set(key, acceptance)
}

const observed = new Set()
const failures = []
const usedOverrides = new Set()
const usedAcceptances = new Set()

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
        const acceptance = acceptances.get(key)
        let kind
        let entry
        let used
        if (override !== undefined && override.reportedLicense === reportedLicense) {
          kind = 'reviewed'
          entry = override
          used = usedOverrides
        } else if (acceptance !== undefined && acceptance.reportedLicense === reportedLicense) {
          kind = 'accepted'
          entry = acceptance
          used = usedAcceptances
        } else {
          failures.push(`${key}: denied or unknown license ${reportedLicense}`)
          continue
        }

        const license = await readFile(resolve(packagePath, entry.licenseFile))
        const digest = createHash('sha256').update(license).digest('hex')
        if (digest !== entry.licenseSha256) {
          failures.push(`${key}: ${kind} license file digest changed`)
          continue
        }
        used.add(key)
      } catch (error) {
        failures.push(
          `${String(packageEntry?.name ?? 'unknown package')}: could not validate license override or acceptance (${String(error)})`,
        )
      }
    }
  }
}

if (observed.size === 0) throw new Error('No production dependency license was detected')
for (const key of overrides.keys()) {
  if (!usedOverrides.has(key)) failures.push(`${key}: license override is stale or unused`)
}
for (const key of acceptances.keys()) {
  if (!usedAcceptances.has(key)) failures.push(`${key}: license acceptance is stale or unused`)
}
if (failures.length > 0) throw new Error(failures.sort().join('\n'))

process.stdout.write(
  `Validated ${observed.size} production dependency license expression(s), ${usedOverrides.size} reviewed override(s) and ${usedAcceptances.size} recorded acceptance(s).\n`,
)
