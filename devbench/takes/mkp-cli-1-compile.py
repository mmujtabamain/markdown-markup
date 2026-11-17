"""mkp CLI, part 1 of 6: checking and building a page (mkp, check, fmt, parse, build, md, flags).

Every command and every line of output is real: devbench/takes/mkp-cli/capture.py ran them with
this repo's mkp and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/mkp-cli/capture.py --work /tmp/mkpv compile
    python3 -m http.server -d /tmp/mkpv/site 8765 &
    devbench video record mkp-cli-1-compile --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "mkp-cli"))
from reel import Reel  # noqa: E402

TITLE = "mkp CLI 1/6: checking and building a page"


def take(t):
    r = Reel(t, "compile")
    r.card(3.2)

    r.chapter(0)
    r.layout("term")
    r.run("usage", "mkp on its own prints its usage, and exits 2.")
    t.beat(r.out("usage", "usage:", 18), "A line or two for each command: fmt, check, parse, build, md, surface, migrate, target check.", 4.0)

    r.chapter(1)
    r.layout("split")
    r.file("check-ok", "counter.mkp.md", "before")
    t.beat("#filebody", "A page: the counter from the plan, with $state, a hole and a press.", 3.4)
    r.run("check-ok", "mkp check reports every error and warning in a file.")
    t.beat(r.exit("check-ok"), "This page has none: nothing printed, exit 0.", 2.8)
    r.file("check-bad", "broken.mkp.md", "before")
    t.beat(r.line("$state.count"), "A copy with two mistakes: a field $state doesn't have…", 2.8)
    t.beat(r.line("label = 5"), "…and a number where press takes a text.", 2.6)
    r.run("check-bad")
    t.beat(r.out("check-bad", "broken.mkp.md:8", 2), "Each error with its file, line and column, and its code.", 3.6)
    r.run("check-json", "--json: the same errors, for editors and tools.")
    t.beat(r.out("check-json", '"code": "names.unknown-field"', 11), "Its code and severity, where it starts and ends, its message, and a fix when there is one.", 3.8)

    r.chapter(2)
    r.file("check-warn", "messy.mkp.md", "before")
    t.beat(r.line("by: number = 1; }"), "Another copy, laid out by hand: a closing brace shares a line.", 3.2)
    r.run("check-warn")
    t.beat(r.out("check-warn", "warning[layout.brace]", 2), "A warning, not an error, so it still exits 0, and it names the fix: mkp fmt.", 3.8)
    r.run("fmt-check", "mkp fmt --check only checks the layout…")
    t.beat(r.out("fmt-check", "not in the canonical layout"), "…and fails when a file isn't in the canonical one.", 3.0)
    r.run("fmt-diff", "--diff shows what fmt would change, and writes nothing.")
    t.beat(r.out("fmt-diff", "--- messy.mkp.md", 12), "Here each changed line is its own hunk: the new lines first, then the old ones.", 3.8)
    r.run("fmt", "mkp fmt writes it in place.")
    r.file("fmt", "messy.mkp.md", "after")
    t.beat(r.changed(), "Four spaces in, and the brace on a line of its own.", 3.2)

    r.chapter(3)
    r.file("check-ok", "counter.mkp.md", "before")
    r.run("parse", "mkp parse prints a file's syntax tree as JSON; here its first 26 lines.")
    t.beat(r.out("parse", '"Comment": {', 7), "Even a comment is in the tree, with where it is.", 3.4)

    r.chapter(4)
    r.run("build", "mkp build writes the page's IR, with core and the packs it uses: here to a file.")
    t.beat(r.out("build", "counter.ir.json"), "One file, with core in it too.", 2.6)
    r.run("build-jq", "Read with jq: the release, the IR's version, the module and the levels it needs.")
    t.beat(r.out("build-jq", '"mkp":"0.3.0"'), "mkp 0.3.0, IR version 3, and core.draw and core.live.", 3.0)
    r.run("rir", "--rir writes the resolved IR instead: what the checker understood, for tools.")
    t.beat(r.out("rir", '"holes": [', 19), "The page's prose, with a hole that reads $state.n, typed as a number.", 3.8)

    r.chapter(5)
    r.run("md", "mkp md writes the page's Markdown, with its starting values.")
    t.beat(r.out("md", "The count is 0."), "The hole reads 0, the count it starts at; the press is its label.", 3.4)
    r.run("md-json", "--json gives its blocks, the way the target checks read them.")
    t.beat(r.out("md-json", '"heading": {', 10), "A heading, then two paragraphs: the sentence, and the press's label.", 3.0)

    r.chapter(6)
    r.run("flag-unknown", "A flag a command doesn't take is a warning, and the command still runs.")
    t.beat(r.out("flag-unknown", "warning: mkp check has no flag --strict"), "check has no --strict: it is ignored, and the check passes.", 3.4)
    r.run("flag-dropped", "A flag MKP 0.2 had and 0.3 dropped stops it, and says what replaced it.")
    t.beat(r.out("flag-dropped", "dropped --format"), "check's --format is --json now; exit 2.", 3.2)

    r.end("Next, part 2: packs, surfaces and the target checks.", 2.8)
