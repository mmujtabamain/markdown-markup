"""Runs every command the mkp-cli takes show, with this repo's mkp, and keeps what each printed.

    python3 devbench/takes/mkp-cli/capture.py --work DIR [--mkp PATH] [reel ...]

Each scene is built afresh in DIR/scenes/<scene> from the repo's own fixtures (the consts of
targets/rust/cli/tests/cli.rs, examples/graphs, schemas/examples/counter.mkp.md). Each step's
command then really runs there, as a terminal would run it, with a copy of the mkp binary
(DIR/bin/mkp, copied from --mkp, by default targets/rust/target/release/mkp) first on PATH.
What it printed, its exit code, how long it took, and the files the step names (before and
after it ran) are written to DIR/site/reels/<reel>.json, beside the player (DIR/site/index.html).
Nothing is ever invented: the player shows only what is in those files.

Then, to film one part:

    python3 -m http.server -d DIR/site 8765 &
    devbench video record mkp-cli-3-migrate --base http://127.0.0.1:8765

Nothing here writes inside the repo: the scenes are copies, and the one step that runs in the
repo (mkp target check) only reads it.
"""

import argparse
import codecs
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
import term  # noqa: E402

CLI_RS = os.path.join(REPO, "targets/rust/cli/tests/cli.rs")


# ------------------------------------------------------------------ fixtures
def cli_consts():
    """The `const NAME: &str = "…";` fixtures of cli.rs, exactly as the tests use them."""
    src = open(CLI_RS, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r'const ([A-Z0-9_]+): &str = "((?:[^"\\]|\\.)*)";', src):
        out[m.group(1)] = codecs.decode(m.group(2), "unicode_escape")
    # the surface test's pack, a `let` inside its test
    m = re.search(r'let pack = "((?:[^"\\]|\\.)*)";\n    let dir = scratch\("surface"', src)
    out["SURFACE_PACK"] = codecs.decode(m.group(1), "unicode_escape")
    return out


C = cli_consts()


def repo_text(path):
    return open(os.path.join(REPO, path), encoding="utf-8").read()


def write(root, files):
    for path, text in files.items():
        p = os.path.join(root, path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(text)


def git_commit(root):
    """A scene in git, everything committed: so mkp migrate says what git can undo."""
    for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "the scene, as it starts"]):
        subprocess.run(["git"] + args, cwd=root, check=True, stdout=subprocess.DEVNULL)


COUNTER = repo_text("schemas/examples/counter.mkp.md")

# check: two mistakes in the counter
BROKEN = COUNTER.replace("\\{$state.n}", "\\{$state.count}").replace('label = "Add"', "label = 5")

# fmt: the counter with a second field, and a brace that doesn't start its own line
MESSY = ('$state {\n  n: number = 0;\n  by: number = 1; }\n@@@\n# Counter\n\nThe count is \\{$state.n}.\n\n'
         '@press(label = "Add", click = fn() { $state.n = $state.n + $state.by; });\n')

# migrate: the questions, numbered in the order they come up
ASKING = (C["MIGRATION"]
          .replace("when = !given(size)", "when = confirm(why = \"Make kit@1's badges small?\")")
          .replace("rename(input = color, to = tone);",
                   "rename(input = color, to = tone);\n        set(input = tone, value = color.ACCENT, "
                   "when = confirm(why = \"Reset every chart's tone?\"), why = \"one tone for charts\");")
          .replace('add(field = unit, value = "", why = "a stat names its unit");',
                   'add(field = unit, value = "", why = "a stat names its unit");\n        '
                   'set(field = unit, value = "deploys", when = confirm(why = "Count every stat in deploys?"), '
                   "why = \"kit@1's stats counted deploys\");"))

# migrate: a case split in two, which only a person can settle
SPLIT = C["MIGRATION"].replace(
    "rename(from = state.LATE, to = state.OVERDUE);",
    'split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = "late is now overdue, or done");')
SPLIT_DOC = C["OLD_DOC"] + '\n@badge(label = $state.s == state.LATE ? "Late" : "On time");\n'

# check: a migration's examples, run through their blocks (as check_runs_each_example_… does)
EXAMPLES = (C["MIGRATION"]
            .replace("rename(input = color, to = tone);",
                     "rename(input = color, to = tone);\n        example(before = @chart(values = [1, 2], color = color.OK), "
                     "after = @plot(values = [1, 2], tone = color.OK));")
            .replace("why = \"kit@1's badges were small\");",
                     "why = \"kit@1's badges were small\");\n        example(before = @badge(label = \"Beta\", shadow = true), "
                     "after = @badge(label = \"Beta\", size = size.S));")
            .replace('why = "a stat names its unit");',
                     'why = "a stat names its unit");\n        example(before = stat { label = "Deploys", value = "42" }, '
                     'after = stat { title = "Deploys", value = "42", unit = "" });'))

USES_KIT1 = 'packs = ["kit"]\n\n[uses]\nkit = 1\n'


def kit_tree(migration=C["MIGRATION"], doc=C["OLD_DOC"], config=USES_KIT1):
    files = {"kit/kit.mkp": C["KIT2"], "kit/surfaces/kit@1.mkp": C["KIT1_SURFACE"],
             "kit/migrations/kit@2.mkp": migration, "docs/report.mkp.md": doc}
    if config is not None:
        files["mkp.toml"] = config
    return files


# Each scene: (files, in git?). "repo" is the repository itself, read only.
SCENES = {
    "pages": ({"counter.mkp.md": COUNTER, "broken.mkp.md": BROKEN, "messy.mkp.md": MESSY}, False),
    "flow": ({"graphs/graphs.mkp": repo_text("examples/graphs/graphs.mkp"),
              "release-flow.mkp.md": repo_text("examples/graphs/release-flow.mkp.md")}, False),
    "kit1": ({"kit/kit.mkp": C["SURFACE_PACK"]}, False),
    "report": (kit_tree(), True),
    "ask": (kit_tree(migration=ASKING), True),
    "split": (kit_tree(migration=SPLIT, doc=SPLIT_DOC), True),
    "ci": (kit_tree(), True),
    "kit2": ({"kit/kit.mkp": C["KIT2"], "kit/surfaces/kit@1.mkp": C["KIT1_SURFACE"],
              "kit/migrations/kit@2.mkp": EXAMPLES}, False),
    "notes": ({"docs/counter.mkp.md": C["COUNTER_02"], "docs/runs.mkp.md": C["RUNS_02"],
               "docs/plain.mkp.md": "# Notes\n\n```js\nlet x = 1;\n```\n",
               "old/units/manifest.mkp": C["UNITS_02_MANIFEST"],
               "old/units/distance.mkp": C["UNITS_02_DISTANCE"]}, False),
}

FROZEN = "~/project/markdown-markup/tools/migrate-0.2/frozen"


def S(id, scene, cmd, show=(), answers=None):
    return {"id": id, "scene": scene, "cmd": cmd, "show": list(show), "answers": answers}


YES = r"\[y/N\] $"

# ------------------------------------------------------------------ the reels
REELS = {
    "compile": {
        "part": 1, "title": "Checking and building a page",
        "chapters": ["mkp", "check", "fmt", "parse", "build", "md", "flags"],
        "steps": [
            S("usage", "pages", "mkp"),
            S("check-ok", "pages", "mkp check counter.mkp.md", show=["counter.mkp.md"]),
            S("check-bad", "pages", "mkp check broken.mkp.md", show=["broken.mkp.md"]),
            S("check-json", "pages", "mkp check --json broken.mkp.md"),
            S("check-warn", "pages", "mkp check messy.mkp.md", show=["messy.mkp.md"]),
            S("fmt-check", "pages", "mkp fmt --check messy.mkp.md"),
            S("fmt-diff", "pages", "mkp fmt --diff messy.mkp.md"),
            S("fmt", "pages", "mkp fmt messy.mkp.md", show=["messy.mkp.md"]),
            S("parse", "pages", "mkp parse counter.mkp.md | head -n 26"),
            S("build", "pages", "mkp build counter.mkp.md -o counter.ir.json && ls -lh counter.ir.json"),
            S("build-jq", "pages", "jq -c '.ir | {mkp, version, module, levels}' counter.ir.json"),
            S("rir", "pages", "mkp build --rir counter.mkp.md | head -n 32"),
            S("md", "pages", "mkp md counter.mkp.md"),
            S("md-json", "pages", "mkp md --json counter.mkp.md"),
            S("flag-unknown", "pages", "mkp check --strict counter.mkp.md"),
            S("flag-dropped", "pages", "mkp check --format json counter.mkp.md"),
        ],
    },
    "packs": {
        "part": 2, "title": "Packs, surfaces and the target checks",
        "chapters": ["--pack", "mkp.toml", "surface", "target check"],
        "steps": [
            S("tree", "flow", "find . -type f | sort", show=["release-flow.mkp.md"]),
            S("no-pack", "flow", "mkp check release-flow.mkp.md"),
            S("pack", "flow", "mkp check --pack graphs release-flow.mkp.md"),
            S("md", "flow", "mkp md --pack graphs release-flow.mkp.md"),
            S("toml", "flow", "echo 'packs = [\"graphs\"]' > mkp.toml && mkp md release-flow.mkp.md"),
            S("surface", "kit1", "mkp surface kit", show=["kit/kit.mkp", "kit/surfaces/kit@1.mkp"]),
            S("surface-check", "kit1", "mkp surface kit --check"),
            S("break", "kit1", "sed -i 's/color: color = color.ACCENT/tone: color = color.ACCENT/' kit/kit.mkp"
              " && mkp check --pack kit kit/kit.mkp", show=["kit/kit.mkp"]),
            S("unbreak", "kit1", "sed -i 's/tone: color = color.ACCENT/color: color = color.ACCENT, title: text = \"\"/'"
              " kit/kit.mkp && mkp check --pack kit kit/kit.mkp", show=["kit/kit.mkp"]),
            S("surface-stale", "kit1", "mkp surface kit --check"),
            S("surface-refused", "kit1", "mkp surface kit"),
            S("surface-force", "kit1", "mkp surface kit --force", show=["kit/surfaces/kit@1.mkp"]),
            S("targets", "repo", "mkp target check test"),
            S("defect", "repo", "mkp target check test --defect no-undo --expect-failures"),
            S("require", "repo", "mkp target check test --require test:acme/chart"),
        ],
    },
    "migrate": {
        "part": 3, "title": "mkp migrate: kit@1 to kit@2",
        "chapters": ["the tree", "look first", "in a terminal"],
        "steps": [
            S("help", "report", "mkp migrate --help"),
            S("tree", "report", "find . -type f -not -path './.git/*' | sort",
              show=["kit/migrations/kit@2.mkp", "docs/report.mkp.md"]),
            S("toml", "report", "cat mkp.toml"),
            S("dry", "report", "mkp migrate docs --dry-run"),
            S("diff", "report", "mkp migrate docs --diff"),
            S("stdout", "report", "mkp migrate docs/report.mkp.md --stdout 2>/dev/null"),
            S("ask", "report", "mkp migrate docs", show=["docs/report.mkp.md"], answers=[(r"Continue\? " + YES, "y\n")]),
            S("toml-after", "report", "cat mkp.toml"),
            S("check-after", "report", "mkp migrate docs --check && mkp check docs/report.mkp.md"),
        ],
    },
    "questions": {
        "part": 4, "title": "mkp migrate: questions, TODOs and errors",
        "chapters": ["--yes 1,3", "asked in a terminal", "--allow-todos", "--allow-errors"],
        "steps": [
            S("dry", "ask", "mkp migrate docs --dry-run", show=["kit/migrations/kit@2.mkp"]),
            S("yes13", "ask", "mkp migrate docs --yes 1,3", show=["docs/report.mkp.md"]),
            S("restore", "ask", "git restore docs mkp.toml"),
            S("asked", "ask", "mkp migrate docs --answers answers.toml", show=["answers.toml", "docs/report.mkp.md"],
              answers=[(r"small\? " + YES, "y\n"), (r"deploys\? " + YES, "n\n"), (r"tone\? " + YES, "y\n"),
                       (r"Continue\? " + YES, "y\n")]),
            S("refused", "split", "mkp migrate docs --yes", show=["kit/migrations/kit@2.mkp", "docs/report.mkp.md"]),
            S("todos", "split", "mkp migrate docs --yes --allow-todos"),
            S("errors", "split", "mkp migrate docs --yes --allow-todos --allow-errors", show=["docs/report.mkp.md"]),
            S("check", "split", "mkp check docs/report.mkp.md"),
        ],
    },
    "reports": {
        "part": 5, "title": "mkp migrate in CI, and a migration's examples",
        "chapters": ["--check", "--format json", "--yes --report", "mkp.toml's release", "examples"],
        "steps": [
            S("check", "ci", "mkp migrate docs --check"),
            S("no-tty", "ci", "mkp migrate docs < /dev/null"),
            S("json", "ci", "mkp migrate docs --dry-run --format json"),
            S("report-md", "ci", "mkp migrate docs --yes --report run.md", show=["run.md", "docs/report.mkp.md"]),
            S("report-json", "ci", "mkp migrate docs --check --report run.json", show=["run.json"]),
            S("write-flag", "ci", "mkp migrate docs --write"),
            S("newer", "ci", "sed -i 's/^mkp = \"0.3.0\"/mkp = \"9.0.0\"/' mkp.toml && mkp migrate docs --check"),
            S("examples", "kit2", "mkp check --pack kit kit/migrations/kit@2.mkp", show=["kit/migrations/kit@2.mkp"]),
            S("bad-after", "kit2", "sed -i 's/size = size.S))/size = size.M))/' kit/migrations/kit@2.mkp"
              " && mkp check --pack kit kit/migrations/kit@2.mkp", show=["kit/migrations/kit@2.mkp"]),
            S("bad-before", "kit2", "sed -i 's/color = color.OK), after/colour = color.OK), after/' kit/migrations/kit@2.mkp"
              " && mkp check --pack kit kit/migrations/kit@2.mkp", show=["kit/migrations/kit@2.mkp"]),
        ],
    },
    "from02": {
        "part": 6, "title": "mkp migrate: from MKP 0.2",
        "chapters": ["a 0.2 tree", "look first", "write, with a stand-in", "check it"],
        "steps": [
            S("tree", "notes", "find . -type f | sort",
              show=["docs/counter.mkp.md", "docs/runs.mkp.md", "old/units/manifest.mkp", "old/units/distance.mkp"]),
            S("frozen", "notes", "ls " + FROZEN + " && node --version"),
            S("dry", "notes", "mkp migrate docs --pack old/units --dry-run"),
            S("changed", "notes", "cp " + FROZEN + "/migrate-0.2.cjs changed.cjs && echo '// changed' >> changed.cjs"
              " && MKP_MIGRATE_02=changed.cjs mkp migrate docs --pack old/units --dry-run"),
            S("write", "notes", "mkp migrate docs --pack old/units --yes --allow-todos",
              show=["docs/counter.mkp.md", "docs/runs.mkp.md", "docs/plain.mkp.md", "docs/stand-ins/units/units.mkp"]),
            S("check", "notes", "mkp check --pack docs/stand-ins docs/counter.mkp.md docs/runs.mkp.md"),
            S("again", "notes", "mkp migrate docs --pack docs/stand-ins,old/units --check"),
        ],
    },
}


# ------------------------------------------------------------------ running
def scene_dir(work, scene):
    if scene == "repo":
        return REPO
    return os.path.join(work, "scenes", scene)


def build_scene(work, scene):
    files, in_git = SCENES[scene]
    root = scene_dir(work, scene)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    write(root, files)
    if in_git:
        git_commit(root)


def snapshot(root, paths):
    out = {}
    for p in paths:
        f = os.path.join(root, p)
        out[p] = open(f, encoding="utf-8").read() if os.path.isfile(f) else None
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def capture(work, name, reel, mkp_sha, built_from):
    built = set()
    steps = []
    for st in reel["steps"]:
        if st["scene"] != "repo" and st["scene"] not in built:
            build_scene(work, st["scene"])
            built.add(st["scene"])
        root = scene_dir(work, st["scene"])
        before = snapshot(root, st["show"])
        t0 = time.monotonic()
        r = term.run(st["cmd"], root, st["answers"])
        seconds = round(time.monotonic() - t0, 2)
        after = snapshot(root, st["show"])
        label = "markdown-markup" if st["scene"] == "repo" else st["scene"]
        steps.append({"id": st["id"], "scene": st["scene"], "prompt": label, "cmd": st["cmd"],
                      "segments": r["segments"], "exit": r["exit"], "seconds": seconds,
                      "tty": bool(st["answers"]), "before": before, "after": after})
        print("  %-16s exit %-3s %6.2fs  %s" % (st["id"], r["exit"], seconds, st["cmd"]))
    return {"reel": name, "part": reel["part"], "parts": len(REELS), "title": reel["title"],
            "chapters": reel["chapters"], "steps": steps, "mkp_sha256": mkp_sha,
            "built_from": built_from, "work": os.path.abspath(work),
            "captured": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--mkp", default=os.path.join(REPO, "targets/rust/target/release/mkp"))
    ap.add_argument("reels", nargs="*")
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    bin_dir = os.path.join(work, "bin")
    os.makedirs(bin_dir, exist_ok=True)
    shutil.copy2(a.mkp, os.path.join(bin_dir, "mkp"))
    term.BIN = bin_dir
    mkp_sha = sha256(os.path.join(bin_dir, "mkp"))
    head = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", "HEAD"], stdout=subprocess.PIPE,
                          text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", REPO, "status", "--porcelain", "--untracked-files=no", "--", "targets/rust"],
                           stdout=subprocess.PIPE, text=True).stdout.strip()
    built_from = head + (" (with uncommitted changes in targets/rust)" if dirty else "")
    site = os.path.join(work, "site")
    os.makedirs(os.path.join(site, "reels"), exist_ok=True)
    shutil.copy2(os.path.join(HERE, "player.html"), os.path.join(site, "index.html"))
    for name in a.reels or list(REELS):
        print("%s:" % name)
        data = capture(work, name, REELS[name], mkp_sha, built_from)
        with open(os.path.join(site, "reels", name + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
