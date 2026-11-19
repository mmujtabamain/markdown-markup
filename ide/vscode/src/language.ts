// Which of the two languages a `.xt.md` is read in: code then prose when it has a `@@@` line
// (`xtmd`); with none, prose all through (`xtmd-prose`), unless it is only code. A TextMate grammar
// reads line by line and can't look ahead for the line, so the extension picks, as the playground
// does.

const CODE_FIRST = /^\s*(?:package|import|\$state|widget|record|enum|fn|let|extern|expose|token|tokens|type|interface|pack)\b/;

export function languageFor(path: string, text: string): "xtmd" | "xtmd-prose" {
  if (!path.endsWith(".xt.md")) return "xtmd";
  if (/^@@@\s*$/m.test(text)) return "xtmd";
  let lines = text.split("\n");
  // front matter is neither
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
    if (end > 0) lines = lines.slice(end + 1);
  }
  const first = lines.find((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  return first !== undefined && CODE_FIRST.test(first) ? "xtmd" : "xtmd-prose";
}
