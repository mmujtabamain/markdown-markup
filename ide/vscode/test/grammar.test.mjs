// The grammars, read as VS Code reads them (vscode-textmate with Oniguruma): each part of a
// document gets the scope a theme colours, the Markdown below `@@@` and in a document with none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vsctm from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
await oniguruma.loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer);
const files = { "source.xtmd": "xtmd.tmLanguage.json", "text.xtmd.prose": "xtmd-prose.tmLanguage.json", "source.xtmdpack": "xtmdpack.tmLanguage.json" };
const registry = new vsctm.Registry({
  onigLib: Promise.resolve({ createOnigScanner: (p) => new oniguruma.OnigScanner(p), createOnigString: (s) => new oniguruma.OnigString(s) }),
  loadGrammar: async (scope) => (files[scope] ? vsctm.parseRawGrammar(readFileSync(join(here, "..", "syntaxes", files[scope]), "utf8"), files[scope]) : null),
});

/** Each token of a text as [its text, its innermost scope, all its scopes]. */
async function tokens(scope, text) {
  const g = await registry.loadGrammar(scope);
  let stack = vsctm.INITIAL;
  const out = [];
  for (const line of text.split("\n")) {
    const r = g.tokenizeLine(line, stack);
    for (const t of r.tokens) out.push([line.slice(t.startIndex, t.endIndex), t.scopes.at(-1), t.scopes]);
    stack = r.ruleStack;
  }
  return out;
}

const scopeOf = (ts, text) => ts.find(([t]) => t === text)?.[1];

test("a document's code above @@@ and its Markdown below get their scopes", async () => {
  const ts = await tokens("source.xtmd", readFileSync(join(here, "workspace", "docs", "poll.xtmd"), "utf8"));
  assert.equal(scopeOf(ts, "import"), "keyword.other.import.xtmd");
  assert.equal(scopeOf(ts, "$state"), "variable.language.state.xtmd");
  assert.equal(scopeOf(ts, "share"), "entity.name.function.xtmd");
  // a type after a colon is a type name
  assert.equal(scopeOf(ts, "int"), "entity.name.type.xtmd");
  assert.equal(scopeOf(ts, "@@@"), "keyword.control.divider.xtmd");
  // below it, Markdown: the heading, a hole with code in it, and widget calls
  assert.ok(ts.find(([t]) => t.includes("Should the team"))[2].includes("markup.heading.markdown"));
  const hole = ts.find(([t]) => t === "\\{");
  assert.equal(hole[1], "punctuation.section.embedded.begin.xtmd");
  assert.equal(scopeOf(ts, "tally"), "entity.name.tag.widget.xtmd");
  assert.equal(scopeOf(ts, '"Yes"'.slice(1, -1)), "string.quoted.double.xtmd");
  assert.equal(scopeOf(ts, "CHECK"), "constant.other.case.xtmd");
  // a call's brackets run over lines: the lambda's body is still code
  assert.ok(ts.filter(([t]) => t === "$state").length >= 4);
});

test("a pack's file is code all through, in its own grammar, with its declarations named", async () => {
  const ts = await tokens("source.xtmdpack", readFileSync(join(here, "workspace", "kit", "kit.xtmdpack"), "utf8"));
  assert.equal(ts[0][2][0], "source.xtmdpack");
  assert.equal(scopeOf(ts, "kit"), "entity.name.namespace.xtmd");
  assert.equal(scopeOf(ts, "tally"), "entity.name.function.xtmd");
  assert.equal(scopeOf(ts, "//@about A count with a name, and a press that adds one."), "comment.line.documentation.xtmd");
  assert.equal(scopeOf(ts, "mut"), "storage.type.xtmd");
});

test("a document with no @@@ is prose all through, with its calls and comments", async () => {
  const ts = await tokens("text.xtmd.prose", "# Hi\n\nSome **bold** and `code`.\n\n@// a note\n@press(label = \"Go\");\n");
  assert.ok(ts.find(([t]) => t.includes("Hi"))[2].includes("markup.heading.markdown"));
  assert.equal(scopeOf(ts, "**bold**"), "markup.bold.markdown");
  assert.equal(scopeOf(ts, "`code`"), "markup.inline.raw.string.markdown");
  assert.equal(scopeOf(ts, "@// a note"), "comment.line.prose.xtmd");
  assert.equal(scopeOf(ts, "press"), "entity.name.tag.widget.xtmd");
});

test("a block's lines are coloured at any indent: its calls, control lines, comments and closing braces", async () => {
  const doc = "@@@\n@mut for (i in $state.items) {\n    @// one row each\n    @if (let x: item = i) {\n        ## A heading\n        @basket_row(name = x.name);\n    }\n}\n\nAfter.\n";
  for (const scope of ["source.xtmd", "text.xtmd.prose"]) {
    const ts = await tokens(scope, scope === "source.xtmd" ? doc : doc.slice(4));
    assert.equal(scopeOf(ts, "for"), "keyword.control.xtmd");
    assert.equal(scopeOf(ts, "if"), "keyword.control.xtmd");
    assert.equal(ts.find(([t]) => t.includes("@// one row each"))[1], "comment.line.prose.xtmd");
    assert.ok(ts.find(([t]) => t.includes("A heading"))[2].includes("markup.heading.markdown"));
    assert.equal(scopeOf(ts, "basket_row"), "entity.name.tag.widget.xtmd");
    // each closing line ends on its line, so what follows is prose again
    assert.ok(!ts.find(([t]) => t.includes("After."))[2].some((s) => s === "meta.call.xtmd" || s === "meta.control.xtmd"));
  }
});
