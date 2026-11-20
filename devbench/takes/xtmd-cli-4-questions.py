"""xtmd CLI, part 4 of 6: xtmd migrate's questions (confirm, --yes 1,3, --answers), --allow-todos and --allow-errors.

Every command and every line of output is real: devbench/takes/xtmd-cli/capture.py ran them with
this repo's xtmd and kept what they printed, and the player only lays that out. To record:

    python3 devbench/takes/xtmd-cli/capture.py --work /tmp/xtmdv questions
    python3 -m http.server -d /tmp/xtmdv/site 8765 &
    devbench video record xtmd-cli-4-questions --base http://127.0.0.1:8765
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "xtmd-cli"))
from reel import Reel  # noqa: E402

TITLE = "xtmd CLI 4/6: xtmd migrate, questions, TODOs and errors"


def take(t):
    r = Reel(t, "questions")
    r.card(3.4)

    r.chapter(0)
    r.file("dry", "kit/migrations/kit@2.xtmdpack", "before")
    t.beat(r.line("Reset every chart's tone?"),
           "This kit@2 migration asks three questions with confirm: reset every chart's tone?", 3.6)
    t.beat(r.line("Make kit@1's badges small?"), "Make kit@1's badges small?", 2.4)
    t.beat(r.line("Count every stat in deploys?"), "Count every stat in deploys?", 2.4)
    r.run("dry", "With nobody to ask, as in CI…")
    t.beat(r.out("dry", "3 questions no one has answered", 7),
           "…nothing is planned: each question is listed, numbered in the order it came up, with how to answer it.", 4.2)
    r.run("yes13", "--yes 1,3 answers yes to those two only, and writes.")
    t.beat(r.out("yes13", "questions:", 4), "1 and 3 yes, 2 no: --yes names the others.", 3.0)
    t.beat(r.out("yes13", "tone = color.ACCENT, was color.OK"), "And each change says why: the tone reset is question 3's, one tone for charts.", 3.6)
    r.file("yes13", "docs/report.xtmd", "after")
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
    r.file("refused", "kit/migrations/kit@2.xtmdpack", "before")
    t.beat(r.line("split(from = state.LATE"),
           "Another kit@2: LATE splits into OVERDUE or DONE, which only a person can choose.", 3.8)
    r.file("refused", "docs/report.xtmd", "before")
    t.beat(r.line("s: state = state.LATE"), "This document uses LATE twice: here…", 2.4)
    t.beat(r.line("$state.s == state.LATE"), "…and here.", 2.0)
    r.run("refused", "A bare --yes answers no question…")
    t.beat(r.out("refused", "2 questions no one has answered", 5),
           "…so each LATE is listed, with how to answer it in --answers, and nothing is written. --yes all answers every yes or no.", 4.6)
    r.run("todos", "--allow-todos leaves what only a person can decide as it was, with a TODO above it…")
    t.beat(r.out("todos", "left for a person", 3), "…two uses, each with a TODO…", 3.0)

    r.chapter(3, clear=False)
    t.beat(r.out("todos", "written though it doesn't compile", 2),
           "…and writes the file, though LATE doesn't compile at those TODOs: they are a person's to finish. Exit 0, as asked.", 4.4)
    r.file("todos", "docs/report.xtmd", "after")
    t.beat(r.line("TODO(xtmd migrate)", 2), "In code, the TODO is a // comment…", 2.8)
    t.beat(r.line("@// TODO(xtmd migrate)", 2), "…above prose, an @// one. Everything else is migrated around them.", 3.6)
    r.run("check", "xtmd check shows what is left to finish.")
    t.beat(r.out("check", "names.unknown-case", 2), "LATE, in both places. (--allow-errors writes a file whose errors aren't at TODOs.)", 3.4)

    r.end("Next, part 5: JSON, reports and a migration's examples.", 2.8)
