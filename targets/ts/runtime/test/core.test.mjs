// core's own tests, run on the TypeScript evaluator. targets/checks/core/*.xtmdpack hold lines such as
// `let check_sorted: bool = nums.sorted() == [1, 2, 3];`, which the compiler folds when it builds
// the file. Each one-line `let check_NAME: bool = EXPR;` is rewritten into
// `fn check_NAME(): bool { return EXPR; }`, so the compiler leaves it as code, and the evaluator
// here calls it: each has to return true. A check the compiler won't take as a fn is kept as a
// let and reported (its value is then the compiler's, not this evaluator's).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Constants, Failure, Machine } from "../dist/index.js";
import { build, declarations, program, repo, workdir } from "./xtmd.mjs";

const coreDir = join(repo, "targets/checks/core");
const files = readdirSync(coreDir).filter((f) => f.endsWith(".xtmdpack")).sort();
const dir = workdir();
const totals = { run: 0, passed: 0, kept: [] };

const CHECK = /^let (check_[A-Za-z0-9_]+): bool = (.*);\s*$/;

/** The rewritten source, and for each of its lines the check written there. */
function rewrite(text, keep) {
  const out = [];
  const lineCheck = [];
  for (const line of text.split("\n")) {
    const m = CHECK.exec(line);
    if (m && !keep.has(m[1])) {
      out.push(`fn ${m[1]}(): bool {`, `    return ${m[2]};`, "}");
      lineCheck.push(m[1], m[1], m[1]);
    } else {
      out.push(line);
      lineCheck.push(m ? m[1] : undefined);
    }
  }
  return { source: out.join("\n"), lineCheck };
}

for (const file of files) {
  test(`core: ${file}`, async (t) => {
    const name = file.replace(/\.xtmdpack$/, "");
    const text = readFileSync(join(coreDir, file), "utf8");
    const keep = new Map();
    let built;
    for (let round = 0; ; round++) {
      const { source, lineCheck } = rewrite(text, new Set(keep.keys()));
      built = build(dir, name, source);
      if (built.ok) {
        break;
      }
      // a check the compiler refuses as a fn goes back to being a let, with its error shown
      let adapted = false;
      for (const e of built.errors) {
        const check = lineCheck[e.line - 1];
        if (check !== undefined && !keep.has(check)) {
          keep.set(check, e.message);
          t.diagnostic(`${file}: ${check} kept as a let, as a fn it fails to compile: ${e.message}`);
          adapted = true;
        }
      }
      assert.ok(adapted && round < 5, `${file} does not compile:\n${built.output}`);
    }
    for (const [check, why] of keep) {
      totals.kept.push(`${file}: ${check} (${why})`);
    }

    const prog = program(built.ir);
    const checks = [...declarations(built.ir, "fn").keys()].filter((n) => /^[^/]+\/check_[A-Za-z0-9_]+$/.test(n) && !n.startsWith("core/"));
    assert.ok(checks.length > 0, `${file} has no checks`);
    for (const check of checks) {
      await t.test(check, () => {
        totals.run += 1;
        let v;
        try {
          v = new Machine(prog, new Constants()).call(check, []);
        } catch (e) {
          if (e instanceof Failure) {
            assert.fail(`${check} failed (${e.kind}): ${e.message}`);
          }
          throw e;
        }
        assert.deepEqual(v && v.kind === "bool" ? v.b : v, true, `${check} returned ${JSON.stringify(v)}`);
        totals.passed += 1;
      });
    }
  });
}

after(() => {
  rmSync(dir, { recursive: true, force: true });
  const kept = totals.kept.length ? `; kept as lets (not run here): ${totals.kept.join(", ")}` : "";
  console.log(`# core checks on the TypeScript evaluator: ${totals.passed}/${totals.run} pass${kept}`);
});
