"""Runs every command the xtmd-cli takes show, with this repo's xtmd, and keeps what each printed.

    python3 devbench/takes/xtmd-cli/capture.py --work DIR [--xtmd PATH] [reel ...]

Each scene is built afresh in DIR/scenes/<scene> from the repo's own fixtures (the consts of
targets/rust/cli/tests/cli.rs, examples/graphs, schemas/examples/counter.xtmd). Each step's
command then really runs there, as a terminal would run it, with a copy of the xtmd binary
(DIR/bin/xtmd, copied from --xtmd, by default targets/rust/target/release/xtmd) first on PATH.
What it printed, its exit code, how long it took, and the files the step names (before and
after it ran) are written to DIR/site/reels/<reel>.json, beside the player (DIR/site/index.html).
Nothing is ever invented: the player shows only what is in those files.

Then, to film one part:

    python3 -m http.server -d DIR/site 8765 &
    devbench video record xtmd-cli-3-migrate --base http://127.0.0.1:8765

Nothing here writes inside the repo: the scenes are copies, and the one step that runs in the
repo (xtmd target check) only reads it.
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
    """A scene in git, everything committed: so xtmd migrate says what git can undo."""
    for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "the scene, as it starts"]):
        subprocess.run(["git"] + args, cwd=root, check=True, stdout=subprocess.DEVNULL)


COUNTER = repo_text("schemas/examples/counter.xtmd")

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
    files = {"kit/kit.xtmdpack": C["KIT2"], "kit/surfaces/kit@1.xtmdpack": C["KIT1_SURFACE"],
             "kit/migrations/kit@2.xtmdpack": migration, "docs/report.xtmd": doc}
    if config is not None:
        files["xtmd.toml"] = config
    return files


# Each scene: (files, in git?). "repo" is the repository itself, read only.
SCENES = {
    "pages": ({"counter.xtmd": COUNTER, "broken.xtmd": BROKEN, "messy.xtmd": MESSY}, False),
    "flow": ({"graphs/graphs.xtmdpack": repo_text("examples/graphs/graphs.xtmdpack"),
              "release-flow.xtmd": repo_text("examples/graphs/release-flow.xtmd")}, False),
    "kit1": ({"kit/kit.xtmdpack": C["SURFACE_PACK"]}, False),
    "report": (kit_tree(), True),
    "ask": (kit_tree(migration=ASKING), True),
    "split": (kit_tree(migration=SPLIT, doc=SPLIT_DOC), True),
    "ci": (kit_tree(), True),
    "kit2": ({"kit/kit.xtmdpack": C["KIT2"], "kit/surfaces/kit@1.xtmdpack": C["KIT1_SURFACE"],
              "kit/migrations/kit@2.xtmdpack": EXAMPLES}, False),
    "notes": ({"docs/counter.mkp.md": C["COUNTER_02"], "docs/runs.mkp.md": C["RUNS_02"],
               "docs/plain.mkp.md": "# Notes\n\n```js\nlet x = 1;\n```\n",
               "old/units/manifest.mkp": C["UNITS_02_MANIFEST"],
               "old/units/distance.mkp": C["UNITS_02_DISTANCE"]}, False),
}

FROZEN = "~/project/markdown-markup/tools/migrate-0.2/frozen"


def S(id, scene, cmd, show=(), answers=None):
    return {"id": id, "scene": scene, "cmd": cmd, "show": list(show), "answers": answers}


YES = r"\[y/N\] $"
# a question of a migration's, asked in turn once every one is listed
ASKED = r"\[y/n\] $"

# ------------------------------------------------------------------ the reels
REELS = {
    "compile": {
        "part": 1, "title": "Checking and building a page",
        "chapters": ["xtmd", "check", "fmt", "parse", "build", "md", "flags"],
        "steps": [
            S("usage", "pages", "xtmd"),
            S("check-ok", "pages", "xtmd check counter.xtmd", show=["counter.xtmd"]),
            S("check-bad", "pages", "xtmd check broken.xtmd", show=["broken.xtmd"]),
            S("check-json", "pages", "xtmd check --format json broken.xtmd"),
            S("check-warn", "pages", "xtmd check messy.xtmd", show=["messy.xtmd"]),
            S("fmt-check", "pages", "xtmd fmt --check messy.xtmd"),
            S("fmt-diff", "pages", "xtmd fmt --diff messy.xtmd"),
            S("fmt", "pages", "xtmd fmt messy.xtmd", show=["messy.xtmd"]),
            S("parse", "pages", "xtmd parse counter.xtmd | head -n 26"),
            S("build", "pages", "xtmd build counter.xtmd --out counter.ir.json && ls -lh counter.ir.json"),
            S("build-jq", "pages", "jq -c '.ir | {xtmd, version, module, levels}' counter.ir.json"),
            S("rir", "pages", "xtmd build --rir counter.xtmd | head -n 32"),
            S("md", "pages", "xtmd md counter.xtmd"),
            S("md-json", "pages", "xtmd md --format json counter.xtmd"),
            S("flag-unknown", "pages", "xtmd check --strict counter.xtmd"),
            S("flag-dropped", "pages", "xtmd fmt --write counter.xtmd"),
        ],
    },
    "packs": {
        "part": 2, "title": "Packs, surfaces and the target checks",
        "chapters": ["--pack", "xtmd.toml", "surface", "target check"],
        "steps": [
            S("tree", "flow", "find . -type f | sort", show=["release-flow.xtmd"]),
            S("no-pack", "flow", "xtmd check release-flow.xtmd"),
            S("pack", "flow", "xtmd check --pack graphs release-flow.xtmd"),
            S("md", "flow", "xtmd md --pack graphs release-flow.xtmd"),
            S("toml", "flow", "echo 'packs = [\"graphs\"]' > xtmd.toml && xtmd md release-flow.xtmd"),
            S("surface", "kit1", "xtmd surface kit", show=["kit/kit.xtmdpack", "kit/surfaces/kit@1.xtmdpack"]),
            S("surface-check", "kit1", "xtmd surface kit --check"),
            S("break", "kit1", "sed -i 's/color: color = color.ACCENT/tone: color = color.ACCENT/' kit/kit.xtmdpack"
              " && xtmd check --pack kit kit/kit.xtmdpack", show=["kit/kit.xtmdpack"]),
            S("unbreak", "kit1", "sed -i 's/tone: color = color.ACCENT/color: color = color.ACCENT, title: text = \"\"/'"
              " kit/kit.xtmdpack && xtmd check --pack kit kit/kit.xtmdpack", show=["kit/kit.xtmdpack"]),
            S("surface-stale", "kit1", "xtmd surface kit --check"),
            S("surface-refused", "kit1", "xtmd surface kit"),
            S("surface-force", "kit1", "xtmd surface kit --force", show=["kit/surfaces/kit@1.xtmdpack"]),
            S("targets", "repo", "xtmd target check test"),
            S("defect", "repo", "xtmd target check test --defect no-undo --expect-failures"),
            S("require", "repo", "xtmd target check test --require test:acme/chart"),
        ],
    },
    "migrate": {
        "part": 3, "title": "xtmd migrate: kit@1 to kit@2",
        "chapters": ["the tree", "look first", "in a terminal"],
        "steps": [
            S("help", "report", "xtmd migrate --help"),
            S("tree", "report", "find . -type f -not -path './.git/*' | sort",
              show=["kit/migrations/kit@2.xtmdpack", "docs/report.xtmd"]),
            S("toml", "report", "cat xtmd.toml"),
            S("dry", "report", "xtmd migrate docs --dry-run"),
            S("diff", "report", "xtmd migrate docs --diff"),
            S("stdout", "report", "xtmd migrate docs/report.xtmd --stdout 2>/dev/null"),
            S("ask", "report", "xtmd migrate docs", show=["docs/report.xtmd"], answers=[(r"Continue\? " + YES, "y\n")]),
            S("toml-after", "report", "cat xtmd.toml"),
            S("check-after", "report", "xtmd migrate docs --check && xtmd check docs/report.xtmd"),
        ],
    },
    "questions": {
        "part": 4, "title": "xtmd migrate: questions, TODOs and errors",
        "chapters": ["--yes 1,3", "asked in a terminal", "a bare --yes, --allow-todos", "what is left"],
        "steps": [
            S("dry", "ask", "xtmd migrate docs --dry-run", show=["kit/migrations/kit@2.xtmdpack"]),
            S("yes13", "ask", "xtmd migrate docs --yes 1,3", show=["docs/report.xtmd"]),
            S("restore", "ask", "git restore docs xtmd.toml"),
            S("asked", "ask", "xtmd migrate docs --answers answers.toml", show=["answers.toml", "docs/report.xtmd"],
              answers=[(r"small\? " + ASKED, "y\n"), (r"deploys\? " + ASKED, "n\n"), (r"tone\? " + ASKED, "y\n"),
                       (r"Continue\? " + YES, "y\n")]),
            S("refused", "split", "xtmd migrate docs --yes", show=["kit/migrations/kit@2.xtmdpack", "docs/report.xtmd"]),
            S("todos", "split", "xtmd migrate docs --yes --allow-todos", show=["docs/report.xtmd"]),
            S("check", "split", "xtmd check docs/report.xtmd"),
        ],
    },
    "reports": {
        "part": 5, "title": "xtmd migrate in CI, and a migration's examples",
        "chapters": ["--check", "--format json", "--yes --report", "xtmd.toml's release", "examples"],
        "steps": [
            S("check", "ci", "xtmd migrate docs --check"),
            S("no-tty", "ci", "xtmd migrate docs < /dev/null"),
            S("json", "ci", "xtmd migrate docs --dry-run --format json"),
            S("report-md", "ci", "xtmd migrate docs --yes --report run.md", show=["run.md", "docs/report.xtmd"]),
            S("report-json", "ci", "xtmd migrate docs --check --report run.json", show=["run.json"]),
            S("write-flag", "ci", "xtmd migrate docs --write"),
            S("newer", "ci", "sed -i 's/^xtmd = \"0.3.0\"/xtmd = \"9.0.0\"/' xtmd.toml && xtmd migrate docs --check"),
            S("examples", "kit2", "xtmd check --pack kit kit/migrations/kit@2.xtmdpack", show=["kit/migrations/kit@2.xtmdpack"]),
            S("bad-after", "kit2", "sed -i 's/size = size.S))/size = size.M))/' kit/migrations/kit@2.xtmdpack"
              " && xtmd check --pack kit kit/migrations/kit@2.xtmdpack", show=["kit/migrations/kit@2.xtmdpack"]),
            S("bad-before", "kit2", "sed -i 's/color = color.OK), after/colour = color.OK), after/' kit/migrations/kit@2.xtmdpack"
              " && xtmd check --pack kit kit/migrations/kit@2.xtmdpack", show=["kit/migrations/kit@2.xtmdpack"]),
        ],
    },
    "fixes": {
        "part": 7, "title": "What the usability test changed",
        "chapters": ["help", "flags", "fmt", "check", "migrate", "target check"],
        "steps": [
            S("version", "pages", "xtmd --version"),
            S("help", "pages", "xtmd fmt --help"),
            S("typo", "pages", "cp messy.xtmd before.xtmd && xtmd fmt --chek messy.xtmd; cmp -s before.xtmd messy.xtmd && echo 'messy.xtmd is as it was'"),
            S("first", "pages", "xtmd --format json check counter.xtmd"),
            S("copy", "pages", "xtmd fmt messy.xtmd --out tidy/messy.xtmd && cmp -s before.xtmd messy.xtmd && echo 'messy.xtmd is as it was'",
              show=["tidy/messy.xtmd"]),
            S("folder", "pages", "xtmd check ."),
            S("missing-pack", "flow", "xtmd check release-flow.xtmd"),
            S("root", "report", "xtmd migrate --dry-run"),
            S("patch", "report", "xtmd migrate --diff 2>/dev/null > migrate.diff && git apply --check migrate.diff && tail -n 9 migrate.diff"),
            S("bare-yes", "ask", "xtmd migrate docs --yes"),
            S("yes-all", "ask", "xtmd migrate docs --yes all", show=["docs/report.xtmd"]),
            S("defect", "repo", "xtmd target check test --defect no-undoo --expect-failures"),
        ],
    },
    "from02": {
        "part": 6, "title": "xtmd migrate: from MKP 0.2",
        "chapters": ["a 0.2 tree", "look first", "write, with a stand-in", "check it"],
        "steps": [
            S("tree", "notes", "find . -type f | sort",
              show=["docs/counter.mkp.md", "docs/runs.mkp.md", "old/units/manifest.mkp", "old/units/distance.mkp"]),
            S("frozen", "notes", "ls " + FROZEN + " && node --version"),
            S("dry", "notes", "xtmd migrate docs --pack old/units --dry-run"),
            S("changed", "notes", "cp " + FROZEN + "/migrate-0.2.cjs changed.cjs && echo '// changed' >> changed.cjs"
              " && XTMD_MIGRATE_02=changed.cjs xtmd migrate docs --pack old/units --dry-run"),
            S("write", "notes", "xtmd migrate docs --pack old/units --yes --allow-todos",
              show=["docs/counter.xtmd", "docs/runs.xtmd", "docs/plain.xtmd", "docs/stand-ins/units/units.xtmdpack"]),
            S("check", "notes", "xtmd check --pack docs/stand-ins docs/counter.xtmd docs/runs.xtmd"),
            S("again", "notes", "xtmd migrate docs --pack docs/stand-ins,old/units --check"),
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


def capture(work, name, reel, xtmd_sha, built_from):
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
            "chapters": reel["chapters"], "steps": steps, "xtmd_sha256": xtmd_sha,
            "built_from": built_from, "work": os.path.abspath(work),
            "captured": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--xtmd", default=os.path.join(REPO, "targets/rust/target/release/xtmd"))
    ap.add_argument("reels", nargs="*")
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    bin_dir = os.path.join(work, "bin")
    os.makedirs(bin_dir, exist_ok=True)
    shutil.copy2(a.xtmd, os.path.join(bin_dir, "xtmd"))
    term.BIN = bin_dir
    xtmd_sha = sha256(os.path.join(bin_dir, "xtmd"))
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
        data = capture(work, name, REELS[name], xtmd_sha, built_from)
        with open(os.path.join(site, "reels", name + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
