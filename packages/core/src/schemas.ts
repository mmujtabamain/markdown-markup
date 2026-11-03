// JSON Schemas (spec 12.1, 13): ir/bundle, ir/definition, ir/node, ir/expr, ir/tokens, the fixture
// file, and every widget's inputs, so other tools validate without our parsers.

import type { IRDef } from './ir';
import { resolve, Type, TypeEnv } from './types';

const BASE = 'https://mkp.dev/schema';
const S2020 = 'https://json-schema.org/draft/2020-12/schema';

const pos = { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 };

export const typeSchema = {
  $id: `${BASE}/ir/type`,
  description: 'An MKP type (spec 6.5).',
  type: 'object',
  required: ['t'],
  properties: { t: { enum: ['num', 'int', 'bool', 'text', 'latex', 'point', 'duration', 'range', 'expr', 'choice', 'list', 'rec', 'named', 'dict', 'records', 'slot', 'ref', 'token', 'fn', 'unknown', 'any'] } },
};

export const exprSchema = {
  $schema: S2020,
  $id: `${BASE}/ir/expr`,
  title: 'MKP expression',
  description: 'An expression: its canonical source and its resolved tree. Operator calls name their declarations, so consumers need an evaluator but no parser.',
  type: 'object',
  required: ['expr', 'ast', 'type'],
  properties: {
    expr: { type: 'string' },
    ast: { $ref: '#/$defs/ast' },
    type: { $ref: `${BASE}/ir/type` },
    pos,
    static: { type: 'boolean' },
  },
  $defs: {
    ast: {
      type: 'object',
      required: ['t'],
      properties: {
        t: { enum: ['num', 'bool', 'str', 'tmpl', 'var', 'list', 'rec', 'dict0', 'point', 'builtin', 'call', 'apply', 'field', 'index', 'not', 'and', 'or', 'if', 'lam', 'fnref'] },
        fn: { type: 'string' },
        name: { type: 'string' },
        from: { enum: ['local', 'inst', 'const'] },
        args: { type: 'array', items: { $ref: '#/$defs/ast' } },
        items: { type: 'array', items: { $ref: '#/$defs/ast' } },
        holes: { type: 'array', items: { $ref: '#/$defs/ast' } },
        params: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

const valSchema = {
  description: 'A prop value: a literal, an expression, typed text or maths, a token, a ref to state, a range, a duration.',
  anyOf: [
    { type: 'object', required: ['lit'] },
    { $ref: `${BASE}/ir/expr` },
    { type: 'object', required: ['text'], properties: { text: { type: 'string' }, maths: { type: 'array' } } },
    { type: 'object', required: ['tex'], properties: { tex: { type: 'string' }, display: { type: 'boolean' }, svg: { type: 'string' }, speech: { type: 'string' } } },
    { type: 'object', required: ['tok', 'kind'], properties: { tok: { type: 'string' }, kind: { type: 'string' } } },
    { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } },
    { type: 'object', required: ['range'], properties: { range: { type: 'array', minItems: 2, maxItems: 2 } } },
    { type: 'object', required: ['ms'], properties: { ms: { type: 'number' } } },
  ],
};

const actionSchema = {
  type: 'object',
  required: ['a'],
  properties: { a: { enum: ['set', 'play', 'pause', 'reset', 'reveal', 'hide', 'open', 'close', 'emit', 'send'] } },
};

export const nodeSchema = {
  $schema: S2020,
  $id: `${BASE}/ir/node`,
  title: 'MKP node',
  description: 'An element, record, built-in or (expanded IR) instance. Nodes are {node, props, records, children, meta, on}.',
  type: 'object',
  required: ['node'],
  properties: {
    node: { type: 'string' },
    def: { type: 'string', pattern: '^[^:]+:[^@]+@\\d+$' },
    props: { type: 'object', additionalProperties: { $ref: '#/$defs/val' } },
    records: { type: 'array', items: { $ref: '#' } },
    children: { type: 'array', items: { $ref: '#' } },
    fills: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#' } } },
    meta: {
      type: 'object',
      properties: { id: {}, if: { $ref: `${BASE}/ir/expr` }, hidden: { type: 'boolean' }, grow: { type: 'boolean' }, basis: { type: 'string' }, comment: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, block: { type: 'integer' }, anchor: { type: 'string' } },
    },
    on: { type: 'object', additionalProperties: { type: 'array', items: actionSchema } },
    pos,
    record: { type: 'string' },
    input: { type: 'string' },
    var: { type: 'string' },
    cases: { type: 'array', items: { type: 'object', required: ['value', 'children'], properties: { children: { type: 'array', items: { $ref: '#' } } } } },
    else: { type: 'array', items: { $ref: '#' } },
    inst: { type: 'object', required: ['def', 'inputs', 'view'], properties: { view: { type: 'array', items: { $ref: '#' } } } },
  },
  $defs: { val: valSchema },
};

export const definitionSchema = {
  $schema: S2020,
  $id: `${BASE}/ir/definition`,
  title: 'MKP definition',
  description: 'One name@N: inputs, fields, record lists, outs, state, derived values, fns, view and projections (spec 13).',
  type: 'object',
  required: ['ir', 'kind', 'id', 'name', 'version', 'pack', 'inputs'],
  properties: {
    ir: { const: 1 },
    kind: { enum: ['widget', 'part', 'extern'] },
    id: { type: 'string' },
    name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]*$' },
    version: { type: 'integer', minimum: 1 },
    pack: { type: 'string' },
    about: { type: 'string' },
    requires: { type: 'array', items: { type: 'string' } },
    budget: { type: 'integer', maximum: 20000000 },
    fields: { type: 'array', items: { type: 'string' } },
    inputs: { type: 'array', items: { type: 'object', required: ['name', 'type'], properties: { name: { type: 'string' }, type: { $ref: `${BASE}/ir/type` } } } },
    outs: { type: 'array' },
    signals: { type: 'array' },
    commands: { type: 'array' },
    values: { type: 'array', items: { type: 'object', required: ['k', 'name'], properties: { k: { enum: ['state', 'var', 'derived', 'fn', 'host'] } } } },
    fns: { type: 'object' },
    view: { type: 'array', items: { $ref: `${BASE}/ir/node` } },
    project: { type: 'object', properties: { md: { $ref: `${BASE}/ir/expr` }, mermaid: { $ref: `${BASE}/ir/expr` } } },
    digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
  },
};

export const tokensSchema = {
  $schema: S2020,
  $id: `${BASE}/ir/tokens`,
  title: 'MKP token set',
  description: "A pack's token defaults per kind and name; color tokens carry a dark value. Providers map the names or fall back to these.",
  type: 'object',
  required: ['name', 'version', 'pack', 'tokens'],
  properties: {
    name: { type: 'string' },
    version: { type: 'integer' },
    pack: { type: 'string' },
    tokens: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { type: 'object' } } },
  },
};

export const bundleSchema = {
  $schema: S2020,
  $id: `${BASE}/ir/bundle`,
  title: 'MKP bundle',
  description: "A document's IR plus the definitions it uses, the base-set signatures, the tokens and the lock: one self-contained JSON (spec 13).",
  type: 'object',
  required: ['ir', 'level', 'doc', 'defs', 'fns', 'consts', 'types', 'tokens', 'capabilities', 'interface', 'lock'],
  properties: {
    ir: { const: 1 },
    level: { enum: ['bundle', 'expanded'] },
    doc: { type: 'object', required: ['file', 'front', 'body'], properties: { body: { type: 'array', items: { $ref: `${BASE}/ir/node` } }, digest: { type: 'string' } } },
    defs: { type: 'object', additionalProperties: { $ref: `${BASE}/ir/definition` } },
    fns: { type: 'object' },
    consts: { type: 'object', additionalProperties: { $ref: `${BASE}/ir/expr` } },
    types: { type: 'object', additionalProperties: { $ref: `${BASE}/ir/type` } },
    tokens: { type: 'array', items: { $ref: `${BASE}/ir/tokens` } },
    macros: { type: 'object', additionalProperties: { type: 'string' } },
    capabilities: { type: 'array', items: { type: 'string' } },
    interface: { type: 'object', required: ['signals', 'hosts', 'commands'] },
    lock: { type: 'object', required: ['packs', 'defs'] },
  },
};

export const fixtureSchema = {
  $schema: S2020,
  $id: `${BASE}/fixture`,
  title: 'MKP fixture file (name.fixture.json)',
  type: 'object',
  required: ['widget', 'cases'],
  additionalProperties: false,
  properties: {
    widget: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*@\\d+$' },
    cases: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          props: { type: 'object' },
          summary: { type: 'string' },
          hosts: { type: 'object' },
          play: {
            type: 'array',
            items: {
              type: 'object',
              minProperties: 1,
              additionalProperties: false,
              properties: { press: { type: 'string' }, set: { type: 'object' }, command: { type: 'string' }, args: { type: 'object' }, wait: { type: 'number', minimum: 0 } },
            },
          },
          expect: { type: 'object', additionalProperties: false, properties: { errors: { type: 'array', items: { type: 'string' } }, md: { type: 'object', additionalProperties: { type: 'string' } }, values: { type: 'object' }, visible: { type: 'array', items: { type: 'string' } } } },
        },
      },
    },
  },
};

export const IR_SCHEMAS = { 'ir/type': typeSchema, 'ir/expr': exprSchema, 'ir/node': nodeSchema, 'ir/definition': definitionSchema, 'ir/tokens': tokensSchema, 'ir/bundle': bundleSchema, fixture: fixtureSchema };

/** The JSON Schema of an MKP type, for widget inputs as a document's YAML (or JSON) gives them. */
export function valueSchema(t: Type, env: TypeEnv, depth = 0): Record<string, unknown> {
  const r = resolve(t, env);
  if (depth > 8) return {};
  switch (r.t) {
    case 'num':
      return { type: 'number', ...(r.lo !== undefined ? { minimum: r.lo, maximum: r.hi } : {}) };
    case 'int':
      return { type: 'integer', ...(r.lo !== undefined ? { minimum: r.lo, maximum: r.hi } : {}) };
    case 'bool':
      return { type: 'boolean' };
    case 'text':
      return { type: 'string', description: 'inline Markdown with $…$ maths' };
    case 'latex':
      return { type: 'string', description: 'maths (TeX), without $' };
    case 'point':
      return { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };
    case 'duration':
      return { type: 'string', pattern: '^\\d+(\\.\\d+)?(ms|s)$' };
    case 'range':
      return { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string', pattern: '^-?[\\d.]+\\.\\.-?[\\d.]+$' }] };
    case 'expr':
      return { type: 'string', description: `an expression in ${r.vars.map((v) => v[0]).join(', ')}` };
    case 'choice':
      return { enum: r.opts };
    case 'list':
      return { type: 'array', items: valueSchema(r.of, env, depth + 1), maxItems: 10000 };
    case 'dict':
      return { type: 'object', additionalProperties: valueSchema(r.of, env, depth + 1) };
    case 'rec': {
      const props: Record<string, unknown> = {};
      for (const [k, ft] of r.fields) props[k] = valueSchema(ft, env, depth + 1);
      return { type: 'object', properties: props, required: r.fields.map((f) => f[0]).filter((k) => r.defaults?.[k] === undefined), additionalProperties: false };
    }
    case 'records': {
      const props: Record<string, unknown> = {};
      for (const [k, ft] of r.fields) props[k] = valueSchema(ft, env, depth + 1);
      if (r.slot) props.slot = { type: 'string', description: 'Markdown' };
      return { type: 'array', items: { type: 'object', properties: props, required: r.fields.map((f) => f[0]).filter((k) => r.defaults?.[k] === undefined && resolve(r.fields.find((f) => f[0] === k)![1], env).t !== 'records'), additionalProperties: false } };
    }
    case 'slot':
      return { type: 'string', description: 'Markdown' };
    case 'ref':
      return { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false };
    case 'token':
      return { type: 'string', description: `a ${r.kind} token name` };
    default:
      return {};
  }
}

/** The JSON Schema of a widget's inputs (`mkp schema name`): what an editor needs to build a form. */
export function inputSchema(d: IRDef, env: TypeEnv): Record<string, unknown> {
  const properties: Record<string, unknown> = { summary: { type: 'string', description: 'what the widget shows, for readers without it and for Markdown output' } };
  const required = ['summary'];
  for (const inp of d.inputs) {
    const s = valueSchema(inp.type, env);
    if (inp.about) s.description = inp.about;
    if (inp.default && 'lit' in inp.default) s.default = inp.default.lit;
    else if (inp.default && 'text' in inp.default) s.default = (inp.default as { text: string }).text;
    else if (inp.default && 'tok' in inp.default) s.default = inp.default.tok;
    properties[inp.name] = s;
    const t = resolve(inp.type, env);
    if (!inp.default && t.t !== 'slot' && t.t !== 'records') required.push(inp.name);
  }
  return { $schema: S2020, $id: `${BASE}/widget/${d.pack}/${d.name}@${d.version}`, title: `${d.name}@${d.version}`, description: d.about, type: 'object', properties, required, additionalProperties: false };
}
