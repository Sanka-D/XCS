export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [k: string]: JSONValue };

export function canonicalize(value: JSONValue): string {
  if (value === undefined) {
    throw new Error('canonicalize: undefined values are not allowed');
  }
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(
        `canonicalize: non-integer number ${value} not allowed in canonical JSON`
      );
    }
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]!))
      .join(',') +
    '}'
  );
}
