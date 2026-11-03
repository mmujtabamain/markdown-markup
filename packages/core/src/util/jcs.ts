// RFC 8785 JSON Canonicalization Scheme: sorted keys (UTF-16 order), ES number formatting, no
// whitespace. Used for every digest in the IR (spec 13).

export function canonicalJson(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonical JSON has no NaN or infinity');
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',') + ']';
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonical JSON can't hold a ${typeof v}`);
  }
}
