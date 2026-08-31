import { sha256 } from './sha256.js'

const XRP_BASE58_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz'

function decodeBase58(value: string): Uint8Array | undefined {
  let number = 0n
  for (const character of value) {
    const digit = XRP_BASE58_ALPHABET.indexOf(character)
    if (digit < 0) return undefined
    number = number * 58n + BigInt(digit)
  }

  const bytes: number[] = []
  while (number > 0n) {
    bytes.push(Number(number & 0xffn))
    number >>= 8n
  }
  bytes.reverse()

  let zeroes = 0
  while (zeroes < value.length && value[zeroes] === XRP_BASE58_ALPHABET[0]) zeroes += 1
  return Uint8Array.from([...new Array<number>(zeroes).fill(0), ...bytes])
}

export function isClassicAddress(value: string): boolean {
  if (typeof value !== 'string' || value.length < 25 || value.length > 35 || value[0] !== 'r') {
    return false
  }
  const decoded = decodeBase58(value)
  if (decoded === undefined || decoded.length !== 25 || decoded[0] !== 0) return false
  const payload = decoded.subarray(0, 21)
  const checksum = sha256(sha256(payload)).subarray(0, 4)
  return checksum.every((byte, index) => byte === decoded[21 + index])
}
