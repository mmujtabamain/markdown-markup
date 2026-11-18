// MKP's npm packages (targets/ts), each after the ones it depends on: @mkp/runtime first, the
// framework bindings last. Shared by the release's build and its publish.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every package with an @mkp name under targets/ts, not a test's or a showcase's; `published`
 * leaves out the private ones (the web target's check adapter). */
export function packages({ published = true } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "dist", "test", "testing"].includes(name)) continue;
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      const file = join(path, "package.json");
      if (existsSync(file)) {
        const text = readFileSync(file, "utf8");
        const pkg = JSON.parse(text);
        if (pkg.name?.startsWith("@mkp/") && !(published && pkg.private)) out.push({ dir: path, file, pkg, text });
      }
      walk(path);
    }
  };
  walk(join(repo, "targets", "ts"));
  return ordered(out);
}

/** Each package after its neighbours in dependencies, optionalDependencies and
 * peerDependencies; devDependencies are only for its own tests. */
function ordered(all) {
  const byName = new Map(all.map((p) => [p.pkg.name, p]));
  const order = [];
  const placed = new Set();
  const place = (p, trail = []) => {
    if (placed.has(p.pkg.name)) return;
    if (trail.includes(p.pkg.name)) throw new Error(`a cycle: ${[...trail, p.pkg.name].join(" → ")}`);
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dep of Object.keys(p.pkg[section] ?? {})) {
        const d = byName.get(dep);
        if (d) place(d, [...trail, p.pkg.name]);
      }
    }
    placed.add(p.pkg.name);
    order.push(p);
  };
  for (const p of all) place(p);
  return order;
}
