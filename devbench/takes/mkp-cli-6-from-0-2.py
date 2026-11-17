"""mkp CLI, part 6 of 6: mkp migrate from MKP 0.2: 0.2.10's frozen compiler run with Node, a 0.2
pack in --pack, a stand-in written with --allow-todos, and the result checked.

Every command and every line of output is real: devbench/takes/mkp-cli/capture.py ran them with
this repo's mkp and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/mkp-cli/capture.py --work /tmp/mkpv from02
    python3 -m http.server -d /tmp/mkpv/site 8765 &
    devbench video record mkp-cli-6-from-0-2 --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "mkp-cli"))
from reel import Reel  # noqa: E402

TITLE = "mkp CLI 6/6: mkp migrate, from MKP 0.2"


def take(t):
    r = Reel(t, "from02")
    r.card(3.4)

    r.chapter(0)
    r.run("tree", "A tree written for MKP 0.2: three documents, and a 0.2 pack, units.")
    r.file("tree", "docs/counter.mkp.md", "before")
    t.beat(r.line("```mkp", 14), "counter.mkp.md defines its widget in 0.2's syntax, in an mkp fence.", 3.6)
    r.file("tree", "docs/runs.mkp.md", "before")
    t.beat(r.line("mkp: 0.2.10", 2), "runs.mkp.md carries 0.2's stamp…", 2.6)
    t.beat(r.line("```distance@1", 5), "…and uses distance@1, from the 0.2 pack units.", 3.0)
    r.file("tree", "old/units/manifest.mkp", "before")
    t.beat("#filebody", "A 0.2 pack is a folder with a manifest.mkp.", 2.8)
    r.run("frozen", "The 0.2 → 0.3 step is 0.2.10's own compiler, frozen in the repo as one file and run with Node.")
    t.beat(r.out("frozen", "migrate-0.2.cjs"), "migrate-0.2.cjs, beside its lock.", 2.8)

    r.chapter(1)
    r.run("dry", "--pack takes the 0.2 pack, beside any 0.3 ones.")
    t.beat(r.out("dry", "docs/counter.mkp.md"), "counter.mkp.md is 0.2's by what 0.2.10 finds in it: 1 change, and 1 thing to know.", 3.8)
    t.beat(r.out("dry", "docs/plain.mkp.md"), "Plain Markdown reads the same in both: up to date.", 2.8)
    t.beat(r.out("dry", "docs/runs.mkp.md"),
           "runs.mkp.md isn't written: units has no 0.3 release here, only a stand-in made from its 0.2 definitions.", 4.6)
    t.beat(r.out("dry", "to know:", 2), "To know: the counter block's summary is dropped; 0.3 builds the Markdown from the widget.", 4.0)
    r.run("changed", "A frozen step that isn't the one this mkp was built with is never run.")
    t.beat(r.out("changed", "SHA-256 differs"), "Its SHA-256 differs: not run, and the file isn't written.", 3.0)
    t.beat(r.out("changed", "docs/counter.mkp.md"),
           "Note: without the step, counter.mkp.md, 0.2 with no stamp, shows as up to date.", 3.8)

    r.chapter(2)
    r.run("write", "--yes --allow-todos writes them, with a stand-in for units.")
    t.beat(r.out("write", "to know:", 3), "To know: the summary dropped, and 0.2's stamp taken out of the front matter.", 3.8)
    t.beat(r.out("write", "left for a person", 2), "Left for a person: units' stand-in, until its own 0.3 release replaces it.", 3.6)
    t.beat(r.out("write", "a stand-in for units", 3), "The stand-in is written, and mkp says how to check against it.", 3.4)
    r.file("write", "docs/counter.mkp.md", "after")
    t.beat(r.line("widget counter(", 19), "The counter in 0.3: a widget with its view and its markdown block…", 3.6)
    t.beat(r.line("@counter(start = 3);"), "…used once on the page.", 2.4)
    r.file("write", "docs/runs.mkp.md", "after")
    t.beat(r.line("@distance("), "runs.mkp.md calls distance, from units.", 2.8)
    t.beat(r.line("Nothing to finish by hand"), "Its header says nothing is left to finish: the TODO is in the stand-in.", 3.6)
    r.file("write", "docs/stand-ins/units/units.mkp", "after")
    t.beat(r.line("TODO(mkp migrate)"), "The stand-in starts with that TODO…", 2.8)
    t.beat(r.line("extern widget distance", 5), "…and gives distance as an extern with a markdown block.", 3.4)

    r.chapter(3)
    r.run("check", "The documents check against the stand-ins…")
    t.beat(r.exit("check"), "…with no errors.", 2.4)
    r.run("again", "And a second run finds every file up to date.")
    t.beat(r.out("again", "3 files:"), "0 to migrate, 3 up to date: exit 0.", 2.8)

    r.end("That is the whole mkp CLI: compiling, packs and targets, and migrate.", 3.4)
