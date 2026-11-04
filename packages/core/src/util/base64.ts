// Base64 without atob/btoa or Buffer (Hermes has neither everywhere).

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(b: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += A[n >> 18] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8);
    out += A[n >> 18] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (A.indexOf(clean[i]) << 18) | (A.indexOf(clean[i + 1]) << 12) | ((A.indexOf(clean[i + 2]) & 63) << 6) | (A.indexOf(clean[i + 3]) & 63);
    out[j++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[j++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[j++] = n & 255;
  }
  return out.slice(0, j);
}
