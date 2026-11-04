// The JSON IR (spec 13). Definitions, bundles and expanded documents are plain JSON in these
// shapes; ir/*.schema.json (schemas.ts) describe them for other tools.

import type { Type } from './types';

export const IR_VERSION = 1;

/** [line, col] in the source file named by the enclosing definition or document. */
export type IRPos = [number, number];

/** A resolved expression tree. Operator calls name their declarations; no parser is needed. */
export type A =
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'str'; v: string }
  /** text or maths with \val{n} holes; mode per hole: tex holes format as maths */
  | { t: 'tmpl'; v: string; tex: boolean; holes: A[]; show: (string | null)[]; modes: ('tex' | 'text')[]; kinds: string[] }
  | { t: 'var'; name: string; from: 'local' | 'inst' | 'const' }
  | { t: 'list'; items: A[] }
  | { t: 'rec'; fields: [string, A][] }
  | { t: 'dict0' }
  | { t: 'point'; x: A; y: A }
  /** builtin calls: fn is "name" (a builtin) */
  | { t: 'builtin'; fn: string; args: A[] }
  /** calls to declared fns and ops: fn is an id in the bundle's (or definition's) fn table */
  | { t: 'call'; fn: string; args: A[] }
  | { t: 'apply'; f: A; args: A[] }
  | { t: 'field'; o: A; name: string }
  | { t: 'index'; o: A; i: A }
  | { t: 'not'; a: A }
  | { t: 'and'; a: A; b: A }
  | { t: 'or'; a: A; b: A }
  | { t: 'if'; c: A; a: A; b: A }
  | { t: 'lam'; params: string[]; body: A }
  /** a reference to a declared fn used as a value */
  | { t: 'fnref'; fn: string };

export interface IRExpr {
  expr: string;
  ast: A;
  type: Type;
  pos?: IRPos;
  /** true when the value reads only inputs and constants (decided at build) */
  static?: boolean;
}

export interface IRText {
  text: string;
  /** \val holes, numbered in order in `text` as \val{0}, \val{1}, … */
  vals?: IRExpr[];
  maths?: IRMaths[];
}

export interface IRMaths {
  tex: string;
  display?: boolean;
  svg?: string;
  speech?: string;
  /** width and height in ex, vertical alignment in ex */
  w?: number;
  h?: number;
  va?: number;
  vals?: IRExpr[];
}

export type IRVal =
  | { lit: unknown; type?: Type }
  | IRExpr
  | ({ text: string } & IRText)
  | ({ tex: string } & IRMaths)
  | { tok: string; kind: string }
  | { ref: string }
  | { range: [IRVal, IRVal] }
  | { ms: number }
  | { slot: IRNode[] };

export type IRAction =
  | { a: 'set'; name: string; target: 'state' | 'var' | 'ref'; value: IRExpr }
  | { a: 'play' | 'pause'; name: string }
  | { a: 'reset'; names: string[] }
  | { a: 'reveal' | 'hide' | 'open' | 'close'; id: string | IRExpr }
  | { a: 'emit'; name: string; payload: [string, IRExpr][] }
  | { a: 'send'; name: string; payload: [string, IRExpr][] };

export interface IRMeta {
  id?: string | IRExpr;
  if?: IRExpr;
  hidden?: boolean;
  grow?: boolean;
  basis?: string;
  span?: IRVal;
  comment?: string[];
  summary?: string;
  block?: number;
  /** the document block's own id (#id) */
  anchor?: string;
  /** a heading's section role (profiles, 16) */
  role?: string;
  /** the profile's block attributes written on this block ({cite=…}), as written (16) */
  attrs?: Record<string, string>;
}

export interface IRNode {
  node: string;
  /** the definition used, for widget and part uses: "pack:name@N" */
  def?: string;
  props?: Record<string, IRVal>;
  records?: IRNode[];
  children?: IRNode[];
  fills?: Record<string, IRNode[]>;
  meta?: IRMeta;
  on?: Record<string, IRAction[]>;
  pos?: IRPos;
  // records
  record?: string;
  input?: string;
  // built-ins
  var?: string;
  in?: IRVal;
  key?: IRExpr;
  subject?: IRExpr;
  cases?: { value: IRVal; children: IRNode[] }[];
  else?: IRNode[];
  value?: IRExpr;
  names?: string[];
  from?: IRVal;
  to?: IRVal;
  label?: IRVal;
  curve?: boolean;
  /** arrow: level and upright runs only, down or across the page (a choice value) */
  route?: IRVal;
  /** arrow: its look (tone, line, head, tail, dim, bold), by name */
  look?: Record<string, IRVal>;
  /** arrow: the ids of the elements the path runs through, in order (a list(text) value) */
  via?: IRVal;
  /** expanded IR: a definition instance */
  inst?: IRInstance;
  /** gfx fallback carried with the node (8.1) */
  fallback?: { png?: string; svg?: string; summary?: string };
}

export interface IRInput {
  name: string;
  type: Type;
  default?: IRVal;
  about?: string;
  pos?: IRPos;
  comment?: string[];
}

export interface IRState {
  k: 'state';
  name: string;
  control: 'slider' | 'choice' | 'toggle' | 'steps' | 'drag';
  type: Type;
  /** slider: min max step; steps: n; drag: x y ranges; choice: opts */
  args: Record<string, IRVal>;
  play?: number;
  loop?: 'once' | 'repeat' | 'bounce';
  default?: IRVal;
  label?: string;
  on?: Record<string, IRAction[]>;
  pos?: IRPos;
  comment?: string[];
}

export type IRValue =
  | IRState
  | { k: 'var'; name: string; type: Type; default: IRVal; about?: string; pos?: IRPos; comment?: string[] }
  | { k: 'derived'; name: string; value: IRExpr; pos?: IRPos; comment?: string[] }
  | { k: 'fn'; name: string; fn: string; params: { name: string; type?: Type }[]; ret?: Type; body: string; pos?: IRPos; comment?: string[] }
  | { k: 'host'; name: string; type: Type; default: IRVal; about?: string; pos?: IRPos; comment?: string[] };

export interface IRFn {
  name: string;
  params: string[];
  types?: Type[];
  ret?: Type;
  body: A;
  src: string;
  /** fns written inside a definition see that instance */
  local?: boolean;
  /** the source fn of a specialisation */
  generic?: string;
  op?: string;
  pos?: IRPos;
  file?: string;
}

export interface IRDef {
  ir: number;
  kind: 'widget' | 'part' | 'extern';
  id: string;
  name: string;
  version: number;
  pack: string;
  file?: string;
  about?: string;
  requires?: string[];
  budget?: number;
  fields?: string[];
  inputs: IRInput[];
  outs?: { name: string; payload?: Type; about?: string; comment?: string[] }[];
  signals?: { name: string; payload: Type; about?: string; comment?: string[] }[];
  commands?: { name: string; payload?: Type; about?: string; actions: IRAction[]; comment?: string[] }[];
  values?: IRValue[];
  fns?: Record<string, IRFn>;
  view?: IRNode[];
  project?: { md?: IRExpr; mermaid?: IRExpr };
  pos?: IRPos;
  comment?: string[];
  digest?: string;
}

export interface IRTokenSet {
  name: string;
  version: number;
  pack: string;
  about?: string;
  /** kind → name → { value, dark?, …props } */
  tokens: Record<string, Record<string, Record<string, unknown>>>;
}

export interface IRLockEntry {
  pack: string;
  version: number;
  digest: string;
}

export interface IRLock {
  packs: IRLockEntry[];
  defs: Record<string, string>;
}

export interface IRInterface {
  signals: { def: string; name: string; payload: Type }[];
  hosts: { def: string; name: string; type: Type; default: IRVal }[];
  commands: { def: string; name: string; payload?: Type }[];
}

export interface IRDoc {
  file: string;
  front: Record<string, unknown>;
  body: IRNode[];
  digest?: string;
}

export interface IRBundle {
  ir: number;
  level: 'bundle' | 'expanded';
  doc: IRDoc;
  defs: Record<string, IRDef>;
  fns: Record<string, IRFn>;
  consts: Record<string, IRExpr>;
  types: Record<string, Type>;
  tokens: IRTokenSet[];
  macros: Record<string, string>;
  capabilities: string[];
  interface: IRInterface;
  lock: IRLock;
  profile?: string;
}

/** Expanded IR: a definition instance with its scope and its inlined view. */
export interface IRInstance {
  def: string;
  /** inputs bound to the caller's scope (values or expressions over the caller) */
  inputs: Record<string, IRVal>;
  view: IRNode[];
}
