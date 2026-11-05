// The URL carries what is shown: the entry (e=), the view settings, and an edited source (src=),
// deflated and base64url-encoded, so a document can be shared by link.

export interface HashState {
  /** the entry's id */
  e?: string;
  /** the edited files, compressed (see packFiles) */
  src?: string;
  theme?: 'light' | 'dark';
  /** narrow screens: the pane shown */
  pane?: 'source' | 'preview' | 'output';
  /** the output tab */
  out?: string;
  /** the preview's width preset */
  w?: 'phone' | 'tablet' | 'desktop';
  motion?: 'reduced';
  gfx?: '0';
}

const KEYS: (keyof HashState)[] = ['e', 'theme', 'pane', 'out', 'w', 'motion', 'gfx', 'src'];

export function readHash(hash = location.hash): HashState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    const v = q.get(k);
    if (v !== null && v !== '') out[k] = v;
  }
  return out as HashState;
}

export function writeHash(s: HashState): string {
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = s[k];
    if (v) q.set(k, v);
  }
  return q.toString();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Edited files (path → text) as a short URL-safe string. */
export async function packFiles(files: Record<string, string>): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(files));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The files a src= value holds, or null when it is not one. */
export async function unpackFiles(src: string): Promise<Record<string, string> | null> {
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(src), new DecompressionStream('deflate-raw')));
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
    return out;
  } catch {
    return null;
  }
}
