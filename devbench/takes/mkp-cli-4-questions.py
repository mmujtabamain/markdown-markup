"""mkp CLI, part 4 of 6: mkp migrate's questions (confirm, --yes 1,3, --answers), --allow-todos and --allow-errors.

Every command and every line of output is real: devbench/takes/mkp-cli/capture.py ran them with
this repo's mkp and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/mkp-cli/capture.py --work /tmp/mkpv questions
    python3 -m http.server -d /tmp/mkpv/site 8765 &
    devbench video record mkp-cli-4-questions --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "mkp-cli"))
from reel import Reel  # noqa: E402

TITLE = "mkp CLI 4/6: mkp migrate, questions, TODOs and errors"


def take(t):
    r = Reel(t, "questions")
    r.card(3.4)

    r.chapter(0)
    r.file("dry", "kit/migrations/kit@2.mkp", "before")
    t.beat(r.line("Reset every chart's tone?"),
           "This kit@2 migration asks three questions with confirm: reset every chart's tone?", 3.6)
    t.beat(r.line("Make kit@1's badges small?"), "Make kit@1's badges small?", 2.4)
    t.beat(r.line("Count every stat in deploys?"), "Count every stat in deploys?", 2.4)
    r.run("dry", "With nobody to ask, as in CI…")
    t.beat(r.out("dry", "questions:", 4),
           "…each is a no, numbered in the order it came up, with the --yes that answers it yes.", 4.0)
    r.run("yes13", "--yes 1,3 answers yes to those two only, and writes.")
    t.beat(r.out("yes13", "questions:", 4), "1 and 3 yes, 2 no, each by --yes.", 3.0)
    r.file("yes13", "docs/report.mkp.md", "after")
    t.beat(r.line("@plot("), "Yes to 3: the chart's tone reset to ACCENT.", 2.8)
    t.beat(r.line("@badge("), "Yes to 1: the badge made small.", 2.4)
    t.beat(r.line("@stats("), "No to 2: the stat's unit left empty.", 2.6)

    r.chapter(1)
    r.run("restore", "Put back with git; now in a terminal, keeping the answers in a file.")
    r.run("asked")
    r.zoom_say(r.out("asked", "1. Make kit@1's badges small?"), "In a terminal, each question is asked as it comes up.", 3.0)
    r.answer("asked", "Yes,")
    r.answer("asked", "no,")
    r.answer("asked", "yes.")
    t.beat(r.out("asked", "questions:", 4), "The summary says who answered each: asked.", 3.0)
    r.answer("asked", "Continue? Yes.")
    r.file("asked", "answers.toml", "after")
    t.beat("#filebody", "--answers kept them in answers.toml, so a run with no terminal answers the same.", 3.8)

    r.chapter(2)
    r.file("refused", "kit/migrations/kit@2.mkp", "before")
    t.beat(r.line("split(from = state.LATE"),
           "Another kit@2: LATE splits into OVERDUE or DONE, which only a person can choose.", 3.8)
    r.file("refused", "docs/report.mkp.md", "before")
    t.beat(r.line("s: state = state.LATE"), "This document uses LATE twice: here…", 2.4)
    t.beat(r.line("$state.s == state.LATE"), "…and here.", 2.0)
    r.run("refused", "--yes can't answer that…")
    t.beat(r.out("refused", "not written"),
           "…so the file isn't written, and mkp says how to answer each: in a terminal, or in --answers.", 4.2)
    t.beat(r.out("refused", "not in git"),
           "Note: this folder is in git, so this \"not in git\" line is wrong. Nothing was written.", 3.6)
    r.run("todos", "--allow-todos leaves what it can't do as it was, with a TODO above it…")
    t.beat(r.out("todos", "not written"),
           "…but then the file still says LATE and doesn't compile, so it isn't written.", 3.8)

    r.chapter(3, clear=False)
    r.run("errors", "--allow-errors writes it anyway.")
    t.beat(r.out("errors", "left for a person", 3), "Two uses left for a person, each with a TODO above it…", 3.2)
    t.beat(r.out("errors", "written with errors", 2), "…and the file written with errors. The run still fails: exit 1.", 3.6)
    r.file("errors", "docs/report.mkp.md", "after")
    t.beat(r.line("TODO(mkp migrate)", 2), "In code, the TODO is a // comment…", 2.8)
    t.beat(r.line("@// TODO(mkp migrate)", 2), "…above prose, an @// one. Everything else is migrated around them.", 3.6)
    r.run("check", "mkp check shows what is left to finish.")
    t.beat(r.out("check", "names.unknown-case", 2), "LATE, in both places.", 2.4)

    r.end("Next, part 5: JSON, reports and a migration's examples.", 2.8)
