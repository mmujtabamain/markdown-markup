"""xtmd CLI, part 7: what the CLI usability test changed (help, flags, fmt, check, migrate, target check).

Every command and every line of output is real: devbench/takes/xtmd-cli/capture.py ran them with
this repo's xtmd and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/xtmd-cli/capture.py --work /tmp/xtmdv fixes
    python3 -m http.server -d /tmp/xtmdv/site 8765 &
    devbench video record xtmd-cli-7-fixes --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "xtmd-cli"))
from reel import Reel  # noqa: E402

TITLE = "xtmd CLI 7: what the usability test changed"


def take(t):
    r = Reel(t, "fixes")
    r.card(3.4)

    r.chapter(0)
    r.layout("term")
    r.run("version", "Fifty agents used xtmd with nothing but a shell. This is what changed. xtmd --version says its release.")
    t.beat(r.out("version", "xtmd 0.3.0"), "xtmd 0.3.0, and the resolved IR's format.", 2.8)
    r.run("help", "Every command has its own --help: its flags, its exit codes, an example.")
    t.beat(r.out("help", "--out f        alone", 2), "fmt's says --out alone writes a copy, and leaves the file as it was.", 3.6)

    r.chapter(1)
    r.run("typo", "A flag xtmd doesn't know is still a warning…")
    t.beat(r.out("typo", "did you mean --check?"), "…now with the flag that was meant…", 3.0)
    t.beat(r.out("typo", "Nothing written"), "…and a run that would rewrite files writes nothing: exit 2.", 3.4)
    t.beat(r.out("typo", "messy.xt.md is as it was"), "The file is as it was.", 2.4)
    r.run("first", "A flag before the command is read as if it came after it.")
    t.beat(r.out("first", '"levels":["core.draw","core.live"]'), "And check's JSON names the levels a document needs to run.", 3.4)

    r.chapter(2)
    r.layout("split")
    r.run("copy", "fmt --out writes the tidy copy, its folder made; the original is untouched.")
    r.file("copy", "tidy/messy.xt.md", "after")
    t.beat("#filebody", "The copy, in the canonical layout.", 2.6)
    r.layout("term")

    r.chapter(3)
    r.run("folder", "check takes a folder now, and says something for every file.")
    t.beat(r.out("folder", "./counter.xt.md: clean; needs core.draw, core.live"), "A clean file says so, with what it needs…", 3.0)
    t.beat(r.out("folder", "5 files: 1 with errors"), "…and several end with a total.", 2.8)
    r.run("missing-pack", "A pack that isn't in the build:")
    t.beat(r.out("missing-pack", "error[names.unknown-pack]", 2), "one error, saying how to add it; the five that follow from it are left out until it is.", 4.0)

    r.chapter(4)
    r.run("root", "xtmd migrate from the tree's own folder reads its xtmd.toml now…")
    t.beat(r.out("root", "kit@1 → kit@2"), "…so it finds the document written for kit@1. Before, it said up to date, and a CI gate passed.", 4.2)
    t.beat(r.out("root", "changed, each by a statement", 7), "Each change says the statement behind it, and its why.", 3.4)
    r.run("patch", "--diff is a patch: only the hunks on stdout, xtmd.toml's too, and git apply takes it.")
    t.beat(r.out("patch", "--- a/xtmd.toml", 9), "xtmd.toml gets the release, and kit = 2.", 3.0)
    r.run("bare-yes", "A bare --yes answers no question: it lists them, and writes nothing.")
    t.beat(r.out("bare-yes", "A bare --yes answers none of them"), "--yes all answers every one; --yes 1,3 those, and the rest no.", 3.6)
    r.run("yes-all", "--yes all:")
    t.beat(r.out("yes-all", "questions:", 4), "every question yes, each said.", 2.8)

    r.chapter(5)
    r.run("defect", "target check names its cases, and a defect the target doesn't have…")
    t.beat(r.out("defect", "the target's adapter didn't run"), "…is an error, exit 2, never \"caught\".", 3.4)

    r.end("All of it is on the branch, in f6a1596, with a test for each.", 3.0)
