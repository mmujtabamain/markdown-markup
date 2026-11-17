"""mkp CLI, part 5 of 6: mkp migrate in CI (--check, no terminal, --format json, --yes with
--report, 0.2's --write), mkp.toml's release, and mkp check running a migration's
example(before = …, after = …).

Every command and every line of output is real: devbench/takes/mkp-cli/capture.py ran them with
this repo's mkp and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/mkp-cli/capture.py --work /tmp/mkpv reports
    python3 -m http.server -d /tmp/mkpv/site 8765 &
    devbench video record mkp-cli-5-reports --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "mkp-cli"))
from reel import Reel  # noqa: E402

TITLE = "mkp CLI 5/6: mkp migrate in CI, and a migration's examples"


def take(t):
    r = Reel(t, "reports")
    r.card(3.4)

    r.chapter(0)
    r.run("check", "The kit@1 tree from part 3, as CI sees it. --check fails if anything would change…")
    t.beat(r.exit("check"), "…and something would: exit 1.", 2.6)
    r.run("no-tty", "With no terminal to ask in, nothing is written…")
    t.beat(r.out("no-tty", "Nothing written: without a terminal"), "…unless --yes says to write.", 3.0)

    r.chapter(1)
    r.layout("term")
    r.run("json", "--format json prints a JSON object for each file, note and question, then the summary.")
    t.beat(r.out("json", '"type":"file"'), "The file: to migrate, kit@1 → kit@2, 5 changes.", 3.2)
    t.beat(r.out("json", '"type":"note"', 2), "A note for each deletion.", 2.4)
    t.beat(r.out("json", '"type":"summary"'), "Then the summary, with the exit code. It asks nothing: it is for tools.", 3.6)
    r.layout("split")

    r.chapter(2)
    r.run("report-md", "--yes writes it; --report writes the whole run to a file, as Markdown…")
    r.file("report-md", "run.md", "after")
    t.beat("#filebody", "…what moved and what was deleted, for a person to read.", 3.4)
    r.run("report-json", "…or as one JSON document: here from --check, now that it passes.")
    r.file("report-json", "run.json", "after")
    t.beat(r.line('"result": "up to date"'), "Each file's result, and the run's summary: up to date, exit 0.", 3.4)
    r.run("write-flag", "0.2's --write is gone.")
    t.beat(r.out("write-flag", "dropped --write"), "mkp migrate writes in place: in a terminal it asks, elsewhere --yes writes.", 3.6)

    r.chapter(3, clear=False)
    r.run("newer", "mkp.toml's mkp = line says the release the tree is written for. Made newer than this mkp…")
    t.beat(r.out("newer", "newer than this mkp"), "…mkp stops, and says to update mkp first: exit 2.", 3.4)

    r.chapter(4)
    r.file("examples", "kit/migrations/kit@2.mkp", "before")
    t.beat(r.line("example(before = @chart"),
           "A migration can carry examples: a kit@1 use before, and the kit@2 use after.", 3.8)
    r.run("examples", "mkp check runs each example through its block.")
    t.beat(r.exit("examples"), "All three come out as their after: exit 0.", 2.8)
    r.run("bad-after", "Now an after the block doesn't come to: size M, not S.")
    r.file("bad-after", "kit/migrations/kit@2.mkp", "after")
    t.beat(r.out("bad-after", "pack.migration-example"), "A compile error: before becomes size.S, not that after.", 3.6)
    r.run("bad-before", "And a before kit@1 can't have: chart had no input colour.")
    t.beat(r.out("bad-before", "doesn't compile against kit@1"), "before doesn't compile against kit@1.", 3.0)

    r.end("Next, part 6: documents written for MKP 0.2.", 2.8)
