"""xtmd CLI, part 2 of 6: packs (--pack, xtmd.toml), surfaces, and xtmd target check.

Every command and every line of output is real: devbench/takes/xtmd-cli/capture.py ran them with
this repo's xtmd and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/xtmd-cli/capture.py --work /tmp/xtmdv packs
    python3 -m http.server -d /tmp/xtmdv/site 8765 &
    devbench video record xtmd-cli-2-packs --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "xtmd-cli"))
from reel import Reel  # noqa: E402

TITLE = "xtmd CLI 2/6: packs, surfaces and the target checks"


def take(t):
    r = Reel(t, "packs")
    r.card(3.6)

    r.chapter(0)
    r.run("tree", "A page built with a pack: the graphs example, copied to a scratch folder.")
    r.file("tree", "release-flow.xtmd", "before")
    t.beat(r.line("import graphs;"), "The page imports graphs, a pack written in Extended Mark.", 3.0)
    r.run("no-pack", "Checked on its own, there is no pack graphs to build with…")
    t.beat(r.out("no-pack", "names.unknown-pack", 8),
           "…so graphs is unknown, and so is all it provides. (Line 5's error comes out three times.)", 4.4)
    r.run("pack", "--pack names the packs to build with: folders and .xtmdpack files.")
    t.beat(r.exit("pack"), "With graphs, no errors: exit 0.", 2.6)
    r.run("md", "And the page's Markdown, built with the pack.")
    t.beat(r.out("md", "# Release flow", 12), "The graph as Markdown: its label, its nodes, then its links.", 3.4)

    r.chapter(1, clear=False)
    r.run("toml", "An xtmd.toml beside the page names its packs, so --pack can be left out.")
    t.beat(r.out("toml", "# Release flow", 12),
           "The same Markdown, with the pack xtmd.toml names. xtmd finds one beside the file or in a folder above.", 4.2)

    r.chapter(2)
    r.file("surface", "kit/kit.xtmdpack", "before")
    t.beat(r.line("pack kit@1", 3), "Another pack, kit, at version 1: a chart widget, two records and a fn.", 3.4)
    r.run("surface", "xtmd surface writes what this version of the pack provides.")
    r.file("surface", "kit/surfaces/kit@1.xtmdpack", "after")
    t.beat("#filebody", "kit@1's surface: declarations only, each widget and fn as an extern signature.", 4.0)
    r.run("surface-check", "--check writes nothing, and fails if the surface is missing or differs.")
    t.beat(r.out("surface-check", "up to date"), "It is up to date.", 2.2)
    r.run("break", "Now a breaking change at the same version: chart's input color is renamed tone.")
    r.file("break", "kit/kit.xtmdpack", "after")
    t.beat(r.out("break", "pack.version-break"),
           "The surface holds kit@1 to what it promised: a break makes a new version, with a migration.", 4.4)
    r.run("unbreak", "Instead, a change that breaks nothing: color back, and a new input, title.")
    r.file("unbreak", "kit/kit.xtmdpack", "after")
    t.beat(r.changed(), "That compiles: a new input with a default breaks no use.", 3.0)
    r.run("surface-stale")
    t.beat(r.out("surface-stale", "out of date"), "But kit@1's surface is now out of date…", 2.8)
    r.run("surface-refused")
    t.beat(r.out("surface-refused", "already written and differs"),
           "…and xtmd won't write over it: a released version's surface doesn't change.", 3.8)
    r.run("surface-force", "--force replaces it all the same.")
    r.file("surface-force", "kit/surfaces/kit@1.xtmdpack", "after")
    t.beat(r.changed(), "The new input, in kit@1's surface.", 2.8)

    r.chapter(3)
    r.run("targets", "xtmd target check runs the target checks on a target, through its check adapter: here, the test target.")
    t.beat(r.out("targets", "test: 62 cases"), "62 cases and 56 steps, and none differ from the case.", 3.4)
    t.beat(r.exit("targets"), "That run took as long as its badge says; the video skips the wait.", 3.0)
    r.run("defect", "--defect switches on a defect in the test target; --expect-failures passes only if a check catches it.")
    t.beat(r.out("defect", "a-failed-handler-is-undone", 2),
           "no-undo: a handler that fails keeps what it changed. The undo case catches it.", 3.8)
    t.beat(r.out("defect", "caught:"), "Caught, so the run passes: exit 0.", 2.6)
    r.run("require", "--require fails the run when a target can't supply something.")
    t.beat(r.out("require", "can't supply"), "The test target supplies core's widgets, and acme/chart isn't one.", 3.4)

    r.end("Next, part 3: xtmd migrate, from kit@1 to kit@2.", 2.8)
