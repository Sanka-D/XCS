import { describe, it, expect } from 'vitest';
import { canonicalize } from '../server/utils/canonical-json';

describe('canonicalize', () => {
  it('sorts top-level keys', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys', () => {
    expect(canonicalize({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalize({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('handles strings, numbers, booleans, null', () => {
    expect(canonicalize({ s: 'x', n: 1, b: true, z: null })).toBe(
      '{"b":true,"n":1,"s":"x","z":null}'
    );
  });

  it('rejects floats (lossy in cross-language contexts)', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow(/non-integer/);
  });

  it('escapes special characters in strings', () => {
    expect(canonicalize({ a: 'he said "hi"\n' })).toBe('{"a":"he said \\"hi\\"\\n"}');
  });
});
