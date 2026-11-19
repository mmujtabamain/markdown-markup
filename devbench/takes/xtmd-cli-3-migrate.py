"""xtmd CLI, part 3 of 6: xtmd migrate, moving a tree from kit@1 to kit@2.

The migration's renames, a drop kept as a comment, a set where !given(size); --dry-run, --diff and
--stdout; the git notice and Continue? [y/N] in a terminal; and xtmd.toml's [uses] and
xtmd = "0.3.0" moving with the tree. (--check, --yes and no terminal are in part 5.)

Every command and every line of output is real: devbench/takes/xtmd-cli/capture.py ran them with
this repo's xtmd and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/xtmd-cli/capture.py --work /tmp/xtmdv migrate
    python3 -m http.server -d /tmp/xtmdv/site 8765 &
    devbench video record xtmd-cli-3-migrate --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "xtmd-cli"))
from reel import Reel  # noqa: E402

TITLE = "xtmd CLI 3/6: xtmd migrate, kit@1 to kit@2"


def take(t):
    r = Reel(t, "migrate")
    r.card(3.4)

    r.chapter(0)
    r.layout("term")
    r.run("help", "xtmd migrate brings documents up to the versions of the packs they are built with.")
    t.beat(r.out("help", "In a terminal it shows", 2),
           "In a terminal it shows what it will change and asks first; elsewhere it writes only with --yes.", 3.8)
    r.layout("split")
    r.run("tree", "A tree to move: a document, its xtmd.toml, and the pack kit, now at version 2.")
    r.file("tree", "kit/migrations/kit@2.xtpack", "before")
    t.beat(r.line("migration kit@1 to kit@2"), "kit@2 holds a migration from kit@1, and kit@1's surface beside it.", 3.4)
    t.beat(r.line("widget chart {", 4), "chart is renamed plot, and its input color, tone.", 3.0)
    t.beat(r.line("widget badge {", 4), "badge's shadow is dropped, and a use that gave no size gets size S.", 3.6)
    t.beat(r.line("widget sparkline {", 3), "sparkline is dropped: a use of it stays, as a comment.", 3.0)
    t.beat(r.line("record stat {", 4), "A stat's label is renamed title, and it gains a unit.", 3.0)
    r.run("toml", "xtmd.toml says the tree is written for kit@1.")
    t.beat(r.out("toml", "kit = 1"), "[uses] kit = 1, and no xtmd = line yet.", 2.8)

    r.chapter(1)
    r.file("tree", "docs/report.xt.md", "before")
    t.beat("#filebody", "The document, written for kit@1.", 2.4)
    r.run("dry", "--dry-run shows what it would do, and writes nothing.")
    t.beat(r.out("dry", "kit@1 → kit@2"), "One file: kit@1 → kit@2, 5 changes and 2 deletions.", 3.2)
    t.beat(r.out("dry", "has no `xtmd =` line"),
           "xtmd.toml has no xtmd = line, so the tree is taken as written for 0.3.0; migrating writes it, and kit = 2.", 4.0)
    t.beat(r.out("dry", "changed, each by a statement", 7),
           "Each change, with the statement of the migration behind it, and its why.", 3.8)
    t.beat(r.out("dry", "warning: the newer versions drop", 3),
           "And a warning for what kit@2 drops: the sparkline, kept as a comment, and shadow = true.", 4.0)
    r.layout("term")
    r.run("diff", "--diff shows each change.")
    t.beat(r.out("diff", "+@plot(", 3), "chart becomes plot, and color becomes tone.", 3.0)
    t.beat(r.out("diff", "+@// kit@2 dropped sparkline", 5), "The sparkline stays, as a comment that says why.", 3.2)
    r.run("stdout", "--stdout prints one document's result, and nothing is written; the summary goes to stderr, here thrown away.")
    t.beat(r.out("stdout", "@badge("), "The badge gave no size, so it gets size S, and its shadow is gone.", 3.4)
    r.layout("split")

    r.chapter(2)
    r.run("ask", "Run in a terminal, it shows the same summary…")
    t.beat(r.out("ask", "git: these files are in a git repository"), "…says git can undo every change…", 3.0)
    t.beat(r.out("ask", "warning: this rewrites 1 file"), "…warns that it rewrites the file, and xtmd.toml's record…", 3.2)
    r.zoom_say(r.out("ask", "Continue? [y/N]"), "…and asks first.", 2.4)
    r.answer("ask", "Yes.")
    t.beat(r.out("ask", "Wrote 1 file.", 3), "Written, and xtmd.toml now says kit@2, and xtmd 0.3.0.", 3.4)
    r.file("ask", "docs/report.xt.md", "after")
    t.beat(r.changed(), "LATE is OVERDUE, the chart a plot with a tone, the badge small, the sparkline a comment, the stat titled, with a unit.", 5.2)
    r.run("toml-after")
    t.beat(r.out("toml-after", 'xtmd = "0.3.0"', 5), "The release the tree is written for, and [uses] kit = 2.", 3.2)
    r.run("check-after", "Checked again, and compiled.")
    t.beat(r.out("check-after", "up to date"), "Up to date, and xtmd check finds nothing: exit 0.", 3.0)

    r.end("Next, part 4: questions, TODOs and errors.", 2.8)
