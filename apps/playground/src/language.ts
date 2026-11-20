// Extended Mark for Monaco: a Monarch tokenizer for `.xtmd` sources, code before the `@@@` line and
// Markdown after it, and the brackets, quotes and comments the editor types and matches.
//
// Two language ids share the tokenizer and start in different states: `xtmd` starts in code and
// turns to prose at `@@@`; `xtmd-prose` is prose all through, as a document with no `@@@` is.
// languageFor() picks one for a source.

import type { monaco as Monaco } from "./monaco.js";

type Monarch = Monaco.languages.IMonarchLanguage;

export const XTMD = "xtmd";
export const XTMD_PROSE = "xtmd-prose";

const keywords = [
  "package", "import", "enum", "record", "type", "interface", "implements", "widget", "extern", "expose", "fn",
  "pack", "tokens", "mut", "let", "event", "invoke", "view", "markdown", "require", "if", "else", "for", "in",
  "match", "case", "return", "only", "step", "void", "any", "param", "slot", "try", "with", "self", "true",
  "false", "as", "token",
];

// core's own types, coloured as types wherever they are named
const coreTypes = [
  "int", "number", "text", "bool", "list", "opt", "map", "date", "moment", "duration", "range", "view", "point",
  "region", "size", "space", "color", "radius", "font", "shadow", "stroke", "template", "md", "rich_text", "latex",
];

const ident = /[a-z_][a-z0-9_]*/;

function tokenizer(start: "code" | "prose"): Monarch {
  return {
    defaultToken: "",
    tokenPostfix: ".xtmd",
    start,
    keywords,
    coreTypes,
    tokenizer: {
      // ---- code: definitions above `@@@`, and a call's arguments in prose

      // `@@@` (Monarch reads `@name` in a rule as one of its attributes, and `@@` as one `@`)
      code: [[/^\x40\x40\x40\s*$/, { token: "divider", switchTo: "@prose" }], { include: "@codeTokens" }],

      codeTokens: [
        [/\/\/@[a-z]+.*$/, "comment.doc"],
        [/\/\/.*$/, "comment"],
        [/\$state\b/, "state"],
        [/@[a-z_][a-z0-9_]*/, "call"],
        [/"/, { token: "string", next: "@string" }],
        [/\d[\d_]*(?:\.\d[\d_]*)?(?:ms|s)?(?![a-z0-9_])/, "number"],
        // the name a declaration gives, and a type named after a colon or before its arguments
        [/(record|enum|interface|type|token|tokens)(\s+)([a-z_][a-z0-9_]*)/, ["keyword", "", "type"]],
        [/(:)(\s*)([a-z_][a-z0-9_]*)(?!\s*\()/, ["delimiter", "", { cases: { "@keywords": "keyword", "@default": "type" } }]],
        [new RegExp(`${ident.source}(?=<[a-z])`), { cases: { "@keywords": "keyword", "@default": "type" } }],
        // a name called, as the editor coloured fns before
        [new RegExp(`${ident.source}(?=\\s*\\()`), { cases: { "@keywords": "keyword", "@default": "function" } }],
        [ident, { cases: { "@keywords": "keyword", "@coreTypes": "type", "@default": "identifier" } }],
        [/[A-Z][A-Z0-9_]*\b/, "case"],
        [/[{}]/, "delimiter.curly"],
        [/[()]/, "delimiter.parenthesis"],
        [/[[\]]/, "delimiter.square"],
        [/[;,.]/, "delimiter"],
        [/[=<>!+\-*/%&|?:]+/, "operator"],
        [/\s+/, ""],
      ],

      // a text literal: on one line, with `\{…}` holes; one left open ends with its line
      string: [
        [/^/, { token: "", next: "@pop" }],
        [/\\\{[^}"]*\}?/, "hole"],
        [/\\./, "string.escape"],
        [/[^\\"]+/, "string"],
        [/"/, { token: "string", next: "@pop" }],
      ],

      // ---- prose: Markdown below `@@@`, read a line at a time

      prose: [
        [/^\s*```.*$/, { token: "code", next: "@fenceBackticks" }],
        [/^\s*~~~.*$/, { token: "code", next: "@fenceTildes" }],
        [/^\s*\$\$\s*$/, { token: "code", next: "@maths" }],
        [/^\s*#{1,6}(?=\s|$)/, { token: "heading", next: "@heading" }],
        // prose's comment: `@//` to the end of the line (`\@//` is text)
        [/^\s*@\/\/.*$/, "comment"],
        // a control line, a call (its arguments may run over lines) and a block's closing line, each
        // at its block's indent
        [/^\s*@(?:mut\s+)?(?:if|for|match|slot)\b/, { token: "call.control", next: "@proseCode" }],
        [/^\s*@[a-z][a-z0-9_]*/, { token: "call", next: "@proseCode" }],
        [/^\s*\}/, { token: "delimiter.curly", next: "@proseCode" }],
        [/^\s*case\b(?=.*\{\s*$)/, { token: "keyword", next: "@proseCode" }],
        [/^\s*(?:[-*+]|\d+\.)\s/, "list"],
        { include: "@inline" },
      ],

      inline: [
        [/\\\{[^}]*\}?/, "hole"],
        [/\\./, ""],
        [/`[^`]+`/, "code"],
        [/\*\*[^*]+\*\*/, "strong"],
        [/__[^_]+__/, "strong"],
        [/\*[^*\s](?:[^*]*[^*\s])?\*/, "emphasis"],
        [/\b_[^_\s](?:[^_]*[^_\s])?_\b/, "emphasis"],
        [/\[[^\]]+\]\([^)]*\)/, "link"],
        [/[^\\`*_[]+/, ""],
        [/./, ""],
      ],

      heading: [
        [/^/, { token: "", next: "@pop" }],
        [/\\\{[^}]*\}?/, "hole"],
        [/[^\\]+/, "heading"],
        [/./, "heading"],
      ],

      // the rest of a call's or a control's line, in code; a new line is prose again
      proseCode: [
        [/^/, { token: "", next: "@pop" }],
        [/\(/, { token: "delimiter.parenthesis", next: "@args" }],
        [/\{(?=\s*$)/, { token: "delimiter.curly", next: "@pop" }],
        [/;/, { token: "delimiter", next: "@pop" }],
        { include: "@codeTokens" },
      ],

      // inside a call's brackets, which may run over several lines
      args: [
        [/\(/, { token: "delimiter.parenthesis", next: "@args" }],
        [/\[/, { token: "delimiter.square", next: "@args" }],
        [/\{/, { token: "delimiter.curly", next: "@args" }],
        [/\)/, { token: "delimiter.parenthesis", next: "@pop" }],
        [/\]/, { token: "delimiter.square", next: "@pop" }],
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
        { include: "@codeTokens" },
      ],

      fenceBackticks: [
        [/^\s*```\s*$/, { token: "code", next: "@pop" }],
        [/.*$/, "code"],
      ],
      fenceTildes: [
        [/^\s*~~~\s*$/, { token: "code", next: "@pop" }],
        [/.*$/, "code"],
      ],
      maths: [
        [/^\s*\$\$\s*$/, { token: "code", next: "@pop" }],
        [/.*$/, "code"],
      ],
    },
  } as Monarch;
}

const configuration: Monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "//" },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  // typed pairs close themselves, and typing the closing one steps over it, so text typed whole
  // (by a person or a recorder) comes out exactly as typed
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string", "comment"] },
  ],
  autoCloseBefore: ";:.,=}])> \n\t",
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "`", close: "`" },
    { open: "*", close: "*" },
  ],
  // no indentation rules: the editor keeps a line's indent on Enter and no more, because in prose
  // an indent changes what a line is (four spaces make code in Markdown)
};

/** Registers both ids, their tokenizer and their brackets. Safe to call once. */
export function registerXtmd(monaco: typeof Monaco): void {
  for (const [id, start] of [
    [XTMD, "code"],
    [XTMD_PROSE, "prose"],
  ] as const) {
    monaco.languages.register({ id, extensions: id === XTMD ? [".xtmdpack", ".xtmd"] : [], aliases: [id === XTMD ? "Extended Mark" : "Extended Mark prose"] });
    monaco.languages.setMonarchTokensProvider(id, tokenizer(start));
    monaco.languages.setLanguageConfiguration(id, configuration);
  }
}

const CODE_FIRST = /^\s*(?:package|import|\$state|widget|record|enum|fn|let|extern|expose|token|tokens|type|interface|pack)\b/;

/**
 * The language a source is read in: code then prose when it has a `@@@` line; with none, prose,
 * as a document with no `@@@` is, unless it is only code (its first line, comments aside, is a
 * declaration, as in a pack's file).
 */
export function languageFor(source: string): string {
  if (/^@@@\s*$/m.test(source)) return XTMD;
  const first = source.split("\n").find((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  return first !== undefined && CODE_FIRST.test(first) ? XTMD : XTMD_PROSE;
}
