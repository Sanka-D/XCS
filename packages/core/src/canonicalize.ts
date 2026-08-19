import { fail } from './errors.js'
import type { JsonValue } from './types.js'

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low < 0xdc00 || low > 0xdfff) {
        fail('JSON_INVALID_UNICODE', 'String contains an unpaired high surrogate', path, {
          offset: index,
        })
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('JSON_INVALID_UNICODE', 'String contains an unpaired low surrogate', path, {
        offset: index,
      })
    }
  }
}

/** RFC 8785 JSON Canonicalization Scheme for I-JSON values. */
export function canonicalize(value: JsonValue): string {
  const stack = new Set<object>()

  const serialize = (current: unknown, path: string): string => {
    if (current === null) return 'null'
    if (typeof current === 'boolean') return current ? 'true' : 'false'
    if (typeof current === 'string') {
      assertValidUnicode(current, path)
      return JSON.stringify(current)
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        return fail('JSON_NON_IJSON_NUMBER', 'JCS only accepts finite numbers', path)
      }
      return JSON.stringify(current)
    }
    if (typeof current !== 'object') {
      return fail('CANONICALIZATION_UNSUPPORTED_VALUE', `Unsupported ${typeof current} value`, path)
    }
    if (stack.has(current)) {
      return fail('CANONICALIZATION_UNSUPPORTED_VALUE', 'Cyclic JSON value', path)
    }

    stack.add(current)
    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.hasOwn(current, index)) {
            return fail(
              'CANONICALIZATION_UNSUPPORTED_VALUE',
              'Sparse arrays are not JSON values',
              `${path}[${index}]`,
            )
          }
        }
        return `[${current.map((item, index) => serialize(item, `${path}[${index}]`)).join(',')}]`
      }

      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        return fail(
          'CANONICALIZATION_UNSUPPORTED_VALUE',
          'Only plain JSON objects can be canonicalized',
          path,
        )
      }

      const record = current as Record<string, unknown>
      const keys = Object.keys(record).sort()
      const properties = keys.map((key) => {
        assertValidUnicode(key, path)
        const propertyPath = `${path}.${key}`
        return `${JSON.stringify(key)}:${serialize(record[key], propertyPath)}`
      })
      return `{${properties.join(',')}}`
    } finally {
      stack.delete(current)
    }
  }

  return serialize(value, '$')
}
