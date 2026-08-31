#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const packageDefinitions = [
  {
    name: '@xcs-protocol/core',
    directory: 'packages/core',
    artifactPrefix: 'xcs-protocol-core',
    expectedFiles: [
      'package/package.json',
      'package/LICENSE',
      'package/README.md',
      'package/dist/index.js',
      'package/dist/index.d.ts',
    ],
    internalDependencies: {},
  },
  {
    name: '@xcs-protocol/sdk',
    directory: 'packages/sdk',
    artifactPrefix: 'xcs-protocol-sdk',
    expectedFiles: [
      'package/package.json',
      'package/LICENSE',
      'package/README.md',
      'package/dist/index.js',
      'package/dist/index.d.ts',
      'package/dist/index.js.map',
    ],
    internalDependencies: { '@xcs-protocol/core': '@xcs-protocol/core' },
  },
  {
    name: '@xcs-protocol/cli',
    directory: 'packages/cli',
    artifactPrefix: 'xcs-protocol-cli',
    expectedFiles: [
      'package/package.json',
      'package/LICENSE',
      'package/README.md',
      'package/dist/index.js',
      'package/dist/index.d.ts',
      'package/dist/index.js.map',
      'package/dist/bin.js',
      'package/dist/bin.js.map',
    ],
    internalDependencies: {
      '@xcs-protocol/core': '@xcs-protocol/core',
      '@xcs-protocol/sdk': '@xcs-protocol/sdk',
    },
  },
]

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`Usage: pnpm package:smoke [-- --output-dir <directory>]

Build, pack, inspect and install the three public XCS packages without network access.
By default all tarballs and the isolated consumer are removed. --output-dir copies the
validated tarballs to an otherwise untouched directory after every smoke check passes.
`)
    return
  }
  if (options.outputDirectory !== undefined) {
    await validateOutputDirectory(options.outputDirectory)
  }

  const scratchDirectory = await mkdtemp(join(tmpdir(), 'xcs-package-smoke-'))

  try {
    const sourceManifestDigests = await readSourceManifestDigests()
    const sourceManifests = await readSourceManifests()
    const rootLicense = await readFile(join(repoRoot, 'LICENSE'), 'utf8')

    const firstPackDirectory = join(scratchDirectory, 'pack-a')
    const secondPackDirectory = join(scratchDirectory, 'pack-b')
    await Promise.all([mkdir(firstPackDirectory), mkdir(secondPackDirectory)])

    const packPasses = []
    for (const [passName, packDirectory] of [
      ['a', firstPackDirectory],
      ['b', secondPackDirectory],
    ]) {
      for (const definition of packageDefinitions) {
        await rm(join(repoRoot, definition.directory, 'dist'), { recursive: true, force: true })
        run(pnpmCommand, ['--filter', definition.name, 'build'], {
          cwd: repoRoot,
          label: `clean build ${passName} ${definition.name}`,
        })
      }

      const packedArtifacts = new Map()
      for (const definition of packageDefinitions) {
        const sourceManifest = sourceManifests.get(definition.name)
        const filename = `${definition.artifactPrefix}-${sourceManifest.version}.tgz`
        const tarball = join(packDirectory, filename)
        const stagedPackage = await stagePackage(
          definition,
          sourceManifest,
          sourceManifests,
          join(scratchDirectory, `staging-${passName}`, definition.artifactPrefix),
        )
        pack(definition, stagedPackage, tarball)
        packedArtifacts.set(definition.name, { filename, path: tarball })
      }
      packPasses.push(packedArtifacts)
    }

    const artifacts = []
    for (const definition of packageDefinitions) {
      const sourceManifest = sourceManifests.get(definition.name)
      const firstArtifact = packPasses[0].get(definition.name)
      const secondArtifact = packPasses[1].get(definition.name)
      assert(firstArtifact !== undefined, `first build omitted ${definition.name}`)
      assert(secondArtifact !== undefined, `second build omitted ${definition.name}`)
      const { filename, path: firstTarball } = firstArtifact
      const { path: secondTarball } = secondArtifact

      const [firstDigest, secondDigest] = await Promise.all([
        sha256File(firstTarball),
        sha256File(secondTarball),
      ])
      if (firstDigest !== secondDigest) {
        const differences = comparePackedArchives(firstTarball, secondTarball)
        throw new Error(
          `${definition.name} is not reproducible: ${firstDigest} != ${secondDigest}; ${differences}`,
        )
      }

      const packedManifest = readPackedManifest(firstTarball)
      validatePackedManifest(definition, sourceManifest, packedManifest, sourceManifests)
      validatePackedFiles(definition, firstTarball, rootLicense)
      artifacts.push({ definition, filename, path: firstTarball, sha256: firstDigest })
    }
    assertSourceManifestsUnchanged(sourceManifestDigests, await readSourceManifestDigests())

    const offlineOverrides = readInstalledOfflineOverrides()
    await smokeConsumer(scratchDirectory, artifacts, sourceManifests, offlineOverrides)

    if (options.outputDirectory !== undefined) {
      await preserveArtifacts(artifacts, options.outputDirectory)
    }

    process.stdout.write('\nValidated package artifacts:\n')
    for (const artifact of artifacts) {
      process.stdout.write(`- ${artifact.filename} sha256:${artifact.sha256}\n`)
    }
    process.stdout.write(
      options.outputDirectory === undefined
        ? 'Temporary tarballs and consumer removed.\n'
        : `Tarballs copied to ${options.outputDirectory}\n`,
    )
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true })
  }
}

function parseArguments(args) {
  let outputDirectory
  let help = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--output-dir') {
      const value = args[index + 1]
      assert(
        value !== undefined && value !== '' && !value.startsWith('--'),
        '--output-dir requires a path',
      )
      assert(outputDirectory === undefined, '--output-dir may only be supplied once')
      outputDirectory = resolve(process.cwd(), value)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return { help, outputDirectory }
}

async function readSourceManifests() {
  const manifests = new Map()
  const rootManifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  assert(
    typeof rootManifest.version === 'string' && rootManifest.version.length > 0,
    'root package has no version',
  )
  for (const definition of packageDefinitions) {
    const manifestPath = join(repoRoot, definition.directory, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert(manifest.name === definition.name, `${manifestPath} has unexpected package name`)
    assert(
      typeof manifest.version === 'string' && manifest.version.length > 0,
      `${definition.name} has no version`,
    )
    assert(
      manifest.version === rootManifest.version,
      `${definition.name} version ${manifest.version} differs from root version ${rootManifest.version}`,
    )
    assert(
      manifest.scripts?.prepack === 'pnpm build',
      `${definition.name} must rebuild its distribution before a direct pack`,
    )
    manifests.set(definition.name, manifest)
  }
  return manifests
}

async function readSourceManifestDigests() {
  return Object.fromEntries(
    await Promise.all(
      packageDefinitions.map(async (definition) => [
        definition.name,
        sha256Bytes(await readFile(join(repoRoot, definition.directory, 'package.json'))),
      ]),
    ),
  )
}

function assertSourceManifestsUnchanged(before, after) {
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    'packaging modified at least one source package manifest',
  )
}

async function stagePackage(definition, sourceManifest, sourceManifests, stageDirectory) {
  const sourceDirectory = join(repoRoot, definition.directory)
  // pnpm can rewrite multiple workspace:* entries in a nondeterministic property order. Materialize
  // one publish-only manifest in scratch space so identical source bytes yield identical tarballs.
  const stagedManifest = structuredClone(sourceManifest)
  for (const [dependency, expectedPackage] of Object.entries(definition.internalDependencies)) {
    stagedManifest.dependencies[dependency] = sourceManifests.get(expectedPackage).version
  }
  delete stagedManifest.scripts.prepack

  await mkdir(stageDirectory, { recursive: true })
  await Promise.all([
    cp(join(sourceDirectory, 'dist'), join(stageDirectory, 'dist'), { recursive: true }),
    copyFile(join(sourceDirectory, 'LICENSE'), join(stageDirectory, 'LICENSE')),
    copyFile(join(sourceDirectory, 'README.md'), join(stageDirectory, 'README.md')),
    writeJson(join(stageDirectory, 'package.json'), stagedManifest),
  ])
  return stageDirectory
}

function pack(definition, packageDirectory, outputPath) {
  run(pnpmCommand, ['--dir', packageDirectory, 'pack', '--out', outputPath], {
    cwd: repoRoot,
    label: `pack ${definition.name}`,
  })
}

function readPackedManifest(tarball) {
  try {
    return JSON.parse(readPackedFile(tarball, 'package/package.json'))
  } catch (error) {
    throw new Error(`Invalid package.json in ${tarball}: ${error.message}`)
  }
}

function readPackedFile(tarball, path) {
  return run('tar', ['-xOf', tarball, path], {
    cwd: repoRoot,
    capture: true,
    label: `inspect ${path}`,
  }).stdout
}

function comparePackedArchives(firstTarball, secondTarball) {
  const firstFiles = listPackedFiles(firstTarball)
  const secondFiles = listPackedFiles(secondTarball)
  const allFiles = new Set([...firstFiles, ...secondFiles])
  const contentDifferences = []

  for (const path of allFiles) {
    const first = firstFiles.has(path) ? readPackedFileBuffer(firstTarball, path) : undefined
    const second = secondFiles.has(path) ? readPackedFileBuffer(secondTarball, path) : undefined
    const firstDigest = first === undefined ? 'missing' : sha256Bytes(first)
    const secondDigest = second === undefined ? 'missing' : sha256Bytes(second)
    if (firstDigest !== secondDigest) {
      contentDifferences.push(`${path} (${firstDigest} != ${secondDigest})`)
    }
  }

  if (contentDifferences.length > 0) return `content differs: ${contentDifferences.join(', ')}`

  const firstMetadata = readTarMetadata(firstTarball)
  const secondMetadata = readTarMetadata(secondTarball)
  return firstMetadata === secondMetadata
    ? 'file contents and visible tar metadata are identical'
    : `tar metadata differs: ${JSON.stringify(firstMetadata)} != ${JSON.stringify(secondMetadata)}`
}

function listPackedFiles(tarball) {
  return new Set(
    run('tar', ['-tzf', tarball], {
      cwd: repoRoot,
      capture: true,
      label: `diagnose ${tarball}`,
    })
      .stdout.split(/\r?\n/u)
      .filter(Boolean)
      .map((entry) => entry.replace(/^\.\//u, '')),
  )
}

function readPackedFileBuffer(tarball, path) {
  const result = spawnSync('tar', ['-xOf', tarball, path], {
    cwd: repoRoot,
    encoding: 'buffer',
  })
  if (result.error !== undefined) throw result.error
  assert(result.status === 0, `could not inspect ${path} in ${tarball}`)
  return result.stdout
}

function readTarMetadata(tarball) {
  return run('tar', ['-tzvf', tarball], {
    cwd: repoRoot,
    capture: true,
    label: `diagnose metadata ${tarball}`,
  }).stdout
}

function validatePackedManifest(definition, sourceManifest, packedManifest, sourceManifests) {
  assert(packedManifest.name === definition.name, `${definition.name} tarball changed its name`)
  assert(
    packedManifest.version === sourceManifest.version,
    `${definition.name} tarball changed its version`,
  )
  assert(packedManifest.private !== true, `${definition.name} tarball is marked private`)
  assert(
    packedManifest.license === 'MIT',
    `${definition.name} must retain its MIT license metadata`,
  )
  assert(
    packedManifest.repository?.url === 'git+https://github.com/XRPL-Commons/XCS.git' &&
      packedManifest.repository?.directory === definition.directory,
    `${definition.name} has invalid repository metadata`,
  )
  assert(
    packedManifest.publishConfig?.access === 'public' &&
      packedManifest.publishConfig?.provenance === true &&
      packedManifest.publishConfig?.registry === 'https://registry.npmjs.org/',
    `${definition.name} must publish publicly to npmjs with provenance enabled`,
  )
  assert(
    packedManifest.exports?.['.']?.types === './dist/index.d.ts' &&
      packedManifest.exports?.['.']?.import === './dist/index.js',
    `${definition.name} has invalid ESM/type exports`,
  )
  assert(
    !JSON.stringify(packedManifest).includes('workspace:'),
    `${definition.name} contains a workspace: dependency`,
  )
  assert(
    packedManifest.scripts?.prepack === undefined,
    `${definition.name} exposes a prepack script that cannot run from the source-free tarball`,
  )

  for (const [dependency, expectedPackage] of Object.entries(definition.internalDependencies)) {
    assert(
      packedManifest.dependencies?.[dependency] === sourceManifests.get(expectedPackage).version,
      `${definition.name} must depend on packed ${dependency} version ${sourceManifests.get(expectedPackage).version}`,
    )
  }

  if (definition.name === '@xcs-protocol/cli') {
    assert(packedManifest.bin?.xcs === './dist/bin.js', 'CLI tarball has an invalid xcs binary')
  } else {
    assert(packedManifest.bin === undefined, `${definition.name} unexpectedly declares a binary`)
  }
}

function validatePackedFiles(definition, tarball, rootLicense) {
  const result = run('tar', ['-tzf', tarball], {
    cwd: repoRoot,
    capture: true,
    label: `list ${definition.name}`,
  })
  const files = new Set(
    result.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((entry) => entry.replace(/^\.\//u, '')),
  )
  const actualFiles = [...files].filter((file) => !file.endsWith('/')).sort()
  const expectedFiles = [...definition.expectedFiles].sort()
  assert(
    JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
    `${definition.name} tarball inventory differs: ${JSON.stringify(actualFiles)} != ${JSON.stringify(expectedFiles)}`,
  )
  assert(
    readPackedFile(tarball, 'package/LICENSE') === rootLicense,
    `${definition.name} tarball license differs from the repository MIT license`,
  )

  if (definition.name === '@xcs-protocol/cli') {
    assert(
      readPackedFile(tarball, 'package/dist/bin.js').startsWith('#!/usr/bin/env node\n'),
      'CLI tarball binary has no Node shebang',
    )
    const binaryMetadata = readTarMetadata(tarball)
      .split(/\r?\n/u)
      .find((line) => line.endsWith(' package/dist/bin.js'))
    assert(binaryMetadata?.startsWith('-rwx'), 'CLI tarball binary is not executable by its owner')
  }
}

function readInstalledOfflineOverrides() {
  const productionResult = run(
    pnpmCommand,
    ['--filter', '@xcs-protocol/cli', 'list', '--prod', '--depth', 'Infinity', '--json'],
    { cwd: repoRoot, capture: true, label: 'resolve installed offline dependency graph' },
  )
  const developmentResult = run(
    pnpmCommand,
    ['--filter', 'xcs', 'list', '--dev', '--depth', 'Infinity', '--json'],
    { cwd: repoRoot, capture: true, label: 'resolve installed offline type toolchain' },
  )
  const productionRoots = JSON.parse(productionResult.stdout)
  const developmentRoots = JSON.parse(developmentResult.stdout)
  const internalNames = new Set(packageDefinitions.map((definition) => definition.name))
  const candidates = new Map()

  function visitDependencies(dependencies) {
    for (const [name, dependency] of Object.entries(dependencies ?? {})) {
      if (dependency === undefined) continue
      if (!internalNames.has(name) && typeof dependency.path === 'string') {
        const current = candidates.get(name)
        if (
          current === undefined ||
          compareVersions(String(dependency.version), String(current.version)) > 0
        ) {
          candidates.set(name, { path: dependency.path, version: dependency.version })
        }
      }
      visitDependencies(dependency.dependencies)
    }
  }

  for (const root of productionRoots) visitDependencies(root.dependencies)
  for (const root of developmentRoots) {
    const typeToolchain = root.devDependencies ?? {}
    visitDependencies({
      '@types/node': typeToolchain['@types/node'],
      typescript: typeToolchain.typescript,
    })
  }
  assert(candidates.has('xrpl'), 'installed offline graph does not contain xrpl')
  assert(candidates.has('commander'), 'installed offline graph does not contain commander')
  assert(candidates.has('@types/node'), 'installed offline graph does not contain @types/node')
  assert(candidates.has('typescript'), 'installed offline graph does not contain typescript')

  return Object.fromEntries(
    [...candidates.entries()].map(([name, dependency]) => [name, `file:${dependency.path}`]),
  )
}

function compareVersions(left, right) {
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
}

async function smokeConsumer(scratchDirectory, artifacts, sourceManifests, offlineOverrides) {
  const consumerDirectory = join(scratchDirectory, 'consumer')
  await mkdir(consumerDirectory)
  const artifactByName = new Map(artifacts.map((artifact) => [artifact.definition.name, artifact]))
  const fileDependency = (name) => `file:${artifactByName.get(name).path}`

  const consumerManifest = {
    name: 'xcs-package-smoke-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(
      packageDefinitions.map((definition) => [definition.name, fileDependency(definition.name)]),
    ),
    devDependencies: {
      '@types/node': offlineOverrides['@types/node'],
      typescript: offlineOverrides.typescript,
    },
    pnpm: {
      overrides: Object.fromEntries([
        ...packageDefinitions.map((definition) => [
          definition.name,
          fileDependency(definition.name),
        ]),
        ...Object.entries(offlineOverrides),
      ]),
    },
  }

  await Promise.all([
    writeJson(join(consumerDirectory, 'package.json'), consumerManifest),
    writeJson(join(consumerDirectory, 'tsconfig.json'), {
      compilerOptions: {
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2023',
      },
      include: ['consumer.ts'],
    }),
    writeFile(join(consumerDirectory, 'consumer.ts'), typeConsumerSource, 'utf8'),
    writeFile(join(consumerDirectory, 'runtime.mjs'), runtimeConsumerSource, 'utf8'),
    writeJson(join(consumerDirectory, 'schema.json'), courseSchema),
  ])

  run(
    pnpmCommand,
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-frozen-lockfile',
      '--config.audit=false',
      '--config.fund=false',
    ],
    { cwd: consumerDirectory, label: 'install tarballs in isolated consumer' },
  )

  const typescriptBinary = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
  )
  run(typescriptBinary, ['--project', join(consumerDirectory, 'tsconfig.json')], {
    cwd: consumerDirectory,
    label: 'compile consumer types',
  })
  run(process.execPath, [join(consumerDirectory, 'runtime.mjs')], {
    cwd: consumerDirectory,
    label: 'import consumer ESM',
  })

  const cliBinary = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'xcs.cmd' : 'xcs',
  )
  const versionResult = run(cliBinary, ['--version'], {
    cwd: consumerDirectory,
    capture: true,
    label: 'run xcs --version',
  })
  assert(
    versionResult.stdout.trim() === sourceManifests.get('@xcs-protocol/cli').version,
    `xcs --version returned ${JSON.stringify(versionResult.stdout.trim())}`,
  )

  const commandResult = run(
    cliBinary,
    ['schema', 'validate', join(consumerDirectory, 'schema.json')],
    {
      cwd: consumerDirectory,
      capture: true,
      label: 'run offline xcs schema validate',
    },
  )
  const parsed = JSON.parse(commandResult.stdout)
  assert(parsed.valid === true, 'offline CLI schema validation did not return valid=true')
  assert(
    parsed.schema?.name === courseSchema.name,
    'offline CLI schema validation changed the schema',
  )
  assert(commandResult.stderr === '', `offline CLI wrote to stderr: ${commandResult.stderr}`)
}

async function preserveArtifacts(artifacts, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true })
  await validateOutputDirectory(outputDirectory)
  const targets = artifacts.map((artifact) => join(outputDirectory, artifact.filename))

  const copied = []
  try {
    for (let index = 0; index < artifacts.length; index += 1) {
      await copyFile(artifacts[index].path, targets[index], fsConstants.COPYFILE_EXCL)
      copied.push(targets[index])
    }
    const actualFiles = (await readdir(outputDirectory)).sort()
    const expectedFiles = artifacts.map((artifact) => artifact.filename).sort()
    assert(
      JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
      `--output-dir inventory differs: ${JSON.stringify(actualFiles)} != ${JSON.stringify(expectedFiles)}`,
    )
  } catch (error) {
    await Promise.all(copied.map((target) => rm(target, { force: true })))
    throw error
  }
}

async function validateOutputDirectory(outputDirectory) {
  try {
    const metadata = await lstat(outputDirectory)
    assert(
      !metadata.isSymbolicLink(),
      `--output-dir must not be a symbolic link: ${outputDirectory}`,
    )
    assert(metadata.isDirectory(), `--output-dir must be a directory: ${outputDirectory}`)
    const entries = await readdir(outputDirectory)
    assert(entries.length === 0, `--output-dir must be empty: ${outputDirectory}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function run(command, args, { cwd, capture = false, label }) {
  process.stdout.write(`\n> ${label}\n`)
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_offline: 'true',
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: capture ? 'pipe' : 'inherit',
  })

  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stderr.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`${label} failed with exit code ${result.status}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function sha256File(path) {
  return sha256Bytes(await readFile(path))
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const courseSchema = {
  xcsVersion: '0.1',
  name: 'Course completion',
  description: 'Attests that a subject completed a course',
  fields: { courseId: { type: 'string' } },
}

const typeConsumerSource = `import {
  canonicalize,
  parseVerificationReport,
  type JsonValue,
  type SchemaCatalogBundleV1,
  type SchemaDefinition,
} from '@xcs-protocol/core'
import {
  buildCredentialCreate,
  createPreparedTransactionEnvelope,
  parsePreparedTransactionEnvelope,
  type AuthoritativeCheckpoint,
  type BuildCredentialCreateInput,
} from '@xcs-protocol/sdk'
import { createProgram, type CliExitCode } from '@xcs-protocol/cli'

const schema: SchemaDefinition = ${JSON.stringify(courseSchema, null, 2)}
const canonical: string = canonicalize(schema as unknown as JsonValue)
const createInput: BuildCredentialCreateInput = {
  issuer: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  subject: 'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn',
  schemaUid: '11'.repeat(32),
  uri: 'https://example.org/credential.json',
}
const transaction = buildCredentialCreate(createInput)
const checkpoint: AuthoritativeCheckpoint = {
  ledgerIndex: 10,
  ledgerHash: '22'.repeat(32),
  closeTime: 800000000,
  transactionRoot: '33'.repeat(32),
}
const prepared = createPreparedTransactionEnvelope({
  profile: {
    profileId: 'package-smoke',
    xcsVersion: '0.1',
    networkId: 1,
    requiredAmendment: '44'.repeat(32),
    registryAddress: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
    registrationAmountDrops: '1',
    activationLedgerIndex: 1,
    activationLedgerHash: '55'.repeat(32),
  },
  profileSha256: '66'.repeat(32),
  checkpoint,
  transaction: {
    ...transaction,
    Fee: '12',
    Sequence: 1,
    LastLedgerSequence: 20,
  },
})
const parsedPrepared = parsePreparedTransactionEnvelope(prepared)
const report = parseVerificationReport({
  onChain: 'active',
  schema: 'valid',
  payload: 'valid',
  issuerTrust: 'unknown',
})
const catalogFormat: SchemaCatalogBundleV1['format'] = 'xcs-schema-catalog/1'
const exitCode: CliExitCode = 0

void [canonical, transaction, parsedPrepared, report, catalogFormat, exitCode, createProgram]
`

const runtimeConsumerSource = `import { canonicalize, parseVerificationReport } from '@xcs-protocol/core'
import { buildCredentialAccept, PREPARED_TRANSACTION_FORMAT } from '@xcs-protocol/sdk'
import { createProgram } from '@xcs-protocol/cli'

if (canonicalize({ b: 2, a: 1 }) !== '{"a":1,"b":2}') {
  throw new Error('core ESM import returned an unexpected canonical value')
}
const transaction = buildCredentialAccept({
  subject: 'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn',
  issuer: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  schemaUid: '11'.repeat(32),
})
const report = parseVerificationReport({
  onChain: 'active',
  schema: 'valid',
  payload: 'valid',
  issuerTrust: 'unknown',
})
if (
  transaction.TransactionType !== 'CredentialAccept' ||
  report.onChain !== 'active' ||
  PREPARED_TRANSACTION_FORMAT !== 'xcs-prepared-transaction/1' ||
  typeof createProgram !== 'function'
) {
  throw new Error('SDK or CLI ESM import returned an unexpected value')
}
`

await main()
