import { env } from 'node:process'

import type { JsonObject, JsonValue } from '../src/index.js'

export const DEFAULT_GENERATIVE_SEED = 0x58435301
export const DEFAULT_GENERATIVE_RUNS = 512

const MAX_GENERATIVE_RUNS = 10_000
const UINT32_MAX = 0xffff_ffffn

export interface GenerativeConfig {
  seed: number
  runs: number
}

export interface GenerativeEnvironment {
  XCS_GENERATIVE_SEED?: string
  XCS_GENERATIVE_RUNS?: string
}

function parseSeed(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_GENERATIVE_SEED
  if (!/^(?:[1-9][0-9]*|0[xX][0-9a-fA-F]+)$/u.test(raw)) {
    throw new Error('XCS_GENERATIVE_SEED must be a non-zero decimal or hexadecimal uint32')
  }
  const value = BigInt(raw)
  if (value === 0n || value > UINT32_MAX) {
    throw new Error('XCS_GENERATIVE_SEED must be a non-zero decimal or hexadecimal uint32')
  }
  return Number(value)
}

function parseRuns(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_GENERATIVE_RUNS
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`XCS_GENERATIVE_RUNS must be an integer from 1 to ${MAX_GENERATIVE_RUNS}`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > MAX_GENERATIVE_RUNS) {
    throw new Error(`XCS_GENERATIVE_RUNS must be an integer from 1 to ${MAX_GENERATIVE_RUNS}`)
  }
  return value
}

export function readGenerativeConfig(source: GenerativeEnvironment = env): GenerativeConfig {
  return {
    seed: parseSeed(source.XCS_GENERATIVE_SEED),
    runs: parseRuns(source.XCS_GENERATIVE_RUNS),
  }
}

/** Small deterministic PRNG used only by conformance tests. */
export class Xorshift32 {
  private state: number

  public constructor(seed: number) {
    if (!Number.isInteger(seed) || seed <= 0 || seed > Number(UINT32_MAX)) {
      throw new Error('xorshift32 seed must be a non-zero uint32')
    }
    this.state = seed >>> 0
  }

  public nextUint32(): number {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('maxExclusive must be a positive safe integer')
    }
    return this.nextUint32() % maxExclusive
  }
}

const STRING_FRAGMENTS = ['', 'a', 'Z', '0', 'é', '€', '😀', '"', '\\', '\n', '\u0000'] as const

const FINITE_NUMBERS = [
  -0,
  0,
  1,
  -1,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.MIN_VALUE,
  333333333.33333329,
  1e30,
] as const

function generateString(random: Xorshift32): string {
  const length = random.nextInt(6)
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += STRING_FRAGMENTS[random.nextInt(STRING_FRAGMENTS.length)]!
  }
  return value
}

function generatePrimitive(random: Xorshift32): JsonValue {
  switch (random.nextInt(5)) {
    case 0:
      return null
    case 1:
      return random.nextInt(2) === 0
    case 2:
      return generateString(random)
    case 3:
      return FINITE_NUMBERS[random.nextInt(FINITE_NUMBERS.length)]!
    default:
      return (random.nextUint32() - 0x8000_0000) / 1_000
  }
}

/** Generates only finite I-JSON values, at most four levels deep and six children wide. */
export function generateJsonValue(random: Xorshift32, depth = 0): JsonValue {
  if (depth >= 4) return generatePrimitive(random)
  const kind = random.nextInt(7)
  if (kind < 5) return generatePrimitive(random)

  const childCount = random.nextInt(7)
  if (kind === 5) {
    return Array.from({ length: childCount }, () => generateJsonValue(random, depth + 1))
  }

  const object: JsonObject = Object.create(null) as JsonObject
  for (let index = 0; index < childCount; index += 1) {
    object[`k${index}_${generateString(random)}`] = generateJsonValue(random, depth + 1)
  }
  return object
}

/** Deeply clones a JSON value while independently shuffling every object's insertion order. */
export function permuteJsonObjects(value: JsonValue, random: Xorshift32): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => permuteJsonObjects(item, random))

  const entries = Object.entries(value)
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const other = random.nextInt(index + 1)
    const currentEntry = entries[index]!
    entries[index] = entries[other]!
    entries[other] = currentEntry
  }
  const result: JsonObject = Object.create(null) as JsonObject
  for (const [key, entryValue] of entries) {
    result[key] = permuteJsonObjects(entryValue, random)
  }
  return result
}
