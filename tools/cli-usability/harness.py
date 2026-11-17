#!/usr/bin/env python3
"""The mkp CLI usability test: fifty tasks a developer might give, each done by an agent that has
only a shell and mkp, and each checked by a script, not by the agent's word.

    python3 tools/cli-usability/harness.py make RUN        # a sandbox per task, its check, tasks.json
    python3 tools/cli-usability/harness.py selftest RUN    # each check fails untouched, passes solved
    python3 tools/cli-usability/harness.py check RUN       # every check over the agents' sandboxes

A task is phrased the way a teammate would ask, often loosely: finding the commands and flags is
part of the test. Its sandbox holds the files it needs (from the CLI's own test fixtures and the
repo's examples); its check runs in the sandbox, with `mkp` on PATH, and exits 0 when the task is
done. A check never trusts the agent's account: it reads the files and asks mkp itself. Each task's
`solution` is one way to do it, used only by `selftest` to prove the check right.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MKP = REPO / "targets/rust/target/release/mkp"


def consts():
    """The fixtures of targets/rust/cli/tests/cli.rs, by name, as the tests have them."""
    src = (REPO / "targets/rust/cli/tests/cli.rs").read_text()
    out = {}
    for m in re.finditer(r'const ([A-Z0-9_]+): &str = "((?:[^"\\]|\\.)*)";', src):
        out[m.group(1)] = json.loads('"' + m.group(2) + '"')
    return out


C = consts()
COUNTER = (REPO / "schemas/examples/counter.mkp.md").read_text()
GRAPHS = (REPO / "examples/graphs/graphs.mkp").read_text()
FLOW = (REPO / "examples/graphs/release-flow.mkp.md").read_text()
MESSY_MKP = "package messy;\nlet   x: number = 1;\n"
NEAT_MKP = "package a;\n\nlet x: number = 1;\n"
BROKEN = '// the counter from the plan\n$state {\n    n: number = 0;\n}\n@@@\n# Counter\n\nThe count is \\{$state.count}.\n\n@press(label = 5, click = fn() { $state.n = $state.n + 1; });\n'
ALSO_BROKEN = "@@@\n# Notes\n\nThe total is \\{$state.total}.\n"
TIDY = '$state {\n    n: number = 0;\n    by: number = 1; }\n@@@\n# Counter\n\nThe count is \\{$state.n}.\n\n@press(label = "Add", click = fn() { $state.n = $state.n + $state.by; });\n'
SYNTAX_BAD = "package t;\n\nlet x: number = ;\n"
MIG_Q = C["MIGRATION"].replace("when = !given(size)", "when = confirm(why = \"Make kit@1's badges small?\")").replace(
    "rename(input = color, to = tone);", "rename(input = color, to = tone);\n        set(input = tone, value = color.ACCENT, when = confirm(why = \"Reset every chart's tone?\"), why = \"one tone for charts\");"
)
MIG_SPLIT = C["MIGRATION"].replace("rename(from = state.LATE, to = state.OVERDUE);", 'split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = "late is now overdue, or done");')
MIG_BAD_EXAMPLE = C["MIGRATION"].replace(
    'why = "kit@1\'s badges were small");', 'why = "kit@1\'s badges were small");\n        example(before = @badge(label = "Beta", shadow = true), after = @badge(label = "Beta", size = size.M));'
)
MIGRATED = 'import kit;\n\n$state {\n    s: state = state.OVERDUE;\n}\n@@@\n# Report\n\n@plot(values = [1, 2], tone = color.OK);\n\n@badge(label = "Beta", size = size.S);\n\n@// kit@2 dropped sparkline: use plot\n@// @sparkline(values = [3]);\n\n@stats(items = [stat { title = "Deploys", value = "42", unit = "" }]);\n'
DASH = 'package dash;\n\nimport kit;\n\npack dash@1 {\n    uses core@1, kit@1;\n    provides summary;\n}\n\nwidget summary(n: number) {\n    view {\n        @chart(values = [n], color = color.OK);\n    }\n    markdown {\n        A summary.\n    }\n}\n'
UNITS_03 = 'package units;\n\npack units@1 {\n    uses core@1;\n    provides distance;\n}\n\nextern widget distance(km: number, label: text = "", summary: text = "");\n'
SHELF_CHANGED = C["SHELF"].replace("widget row_of_books(title: text)", "widget row_of_books(name: text)").replace("@label(value = title);", "@label(value = name);").replace("\\{title}", "\\{name}")


def kit(doc=None, migration=None, toml='packs = ["kit"]\n\n[uses]\nkit = 1\n'):
    files = {"kit/kit.mkp": C["KIT2"], "kit/surfaces/kit@1.mkp": C["KIT1_SURFACE"], "kit/migrations/kit@2.mkp": migration or C["MIGRATION"], "docs/report.mkp.md": doc or C["OLD_DOC"]}
    if toml is not None:
        files["mkp.toml"] = toml
    return files


# Each task: its id, what it is about, the goal as a teammate would put it, the sandbox's files,
# a setup command (run in the sandbox after the files are written), one solution, and the check.
TASKS = [
    # ---- formatting
    dict(id="01-tidy", area="fmt", goal="messy.mkp looks off. Tidy it up the standard way.", files={"messy.mkp": MESSY_MKP},
         solution="mkp fmt messy.mkp", check="mkp fmt --check messy.mkp >/dev/null 2>&1 || fail 'messy.mkp is still not in the canonical layout'"),
    dict(id="02-which-untidy", area="fmt", goal="CI should tell me which .mkp files under src/ aren't laid out properly, without touching them. Put the names of the ones that aren't in answer.txt.",
         files={"src/a.mkp": NEAT_MKP, "src/b.mkp": MESSY_MKP.replace("messy", "b"), "src/c.mkp": MESSY_MKP.replace("messy", "c")},
         solution="mkp fmt --check src/*.mkp 2>&1 | grep -o '[a-z]*\\.mkp' > answer.txt",
         check="unchanged src/a.mkp src/b.mkp src/c.mkp; names_are b.mkp c.mkp"),
    dict(id="03-review-format", area="fmt", goal="Before I let the formatter loose on tidy.mkp.md, show me exactly what it would change. Save that somewhere I can review it: change.diff.", files={"tidy.mkp.md": TIDY},
         solution="mkp fmt --diff tidy.mkp.md > change.diff", check="unchanged tidy.mkp.md; grep -q '^@@' change.diff || fail 'change.diff has no hunk'; grep -q '^+' change.diff || fail 'change.diff adds nothing'"),
    dict(id="04-clean-copy", area="fmt", goal="I need a properly laid-out copy of messy.mkp next to it, called clean.mkp. The original must stay exactly as it is.", files={"messy.mkp": MESSY_MKP},
         solution="mkp fmt --stdout messy.mkp > clean.mkp", check="unchanged messy.mkp; [ \"$(mkp fmt --stdout messy.mkp)\" = \"$(cat clean.mkp)\" ] || fail 'clean.mkp is not messy.mkp in the canonical layout'"),
    dict(id="05-format-verdict-data", area="fmt", goal="My editor plugin wants the formatter's verdict on every .mkp file in this folder as machine-readable data. Produce it in fmt.jsonl.",
         files={"a.mkp": NEAT_MKP, "b.mkp": MESSY_MKP.replace("messy", "b")},
         solution="mkp fmt --check --format json a.mkp b.mkp > fmt.jsonl",
         check="jsonl fmt.jsonl; last_type fmt.jsonl summary; grep -q '\"file\":\"a.mkp\"' fmt.jsonl && grep -q '\"file\":\"b.mkp\"' fmt.jsonl || fail 'fmt.jsonl does not name both files'"),
    # ---- checking
    dict(id="06-how-many-problems", area="check", goal="How many problems does broken.mkp.md have? Just the number in answer.txt.", files={"broken.mkp.md": BROKEN},
         solution="echo 2 > answer.txt", check="unchanged broken.mkp.md; answer_is 2"),
    dict(id="07-type-problem-line", area="check", goal="Which line of broken.mkp.md has the type problem? Put just the line number in answer.txt.", files={"broken.mkp.md": BROKEN},
         solution="echo 10 > answer.txt", check="unchanged broken.mkp.md; answer_is \"$(mkp check --format json broken.mkp.md | grep '\"types\\.' | grep -o '\"line\":[0-9]*' | head -1 | cut -d: -f2)\""),
    dict(id="08-problems-as-data", area="check", goal="Give me broken.mkp.md's problems as data I can feed to a dashboard, in problems.jsonl.", files={"broken.mkp.md": BROKEN},
         solution="mkp check --format json broken.mkp.md > problems.jsonl", check="jsonl problems.jsonl; [ \"$(grep -c '\"type\":\"diagnostic\"' problems.jsonl)\" = 2 ] || fail 'problems.jsonl does not hold the two diagnostics'"),
    dict(id="09-does-it-compile", area="check", goal="Does release-flow.mkp.md compile? It's meant to use the pack in graphs/. Answer yes or no in answer.txt.", files={"release-flow.mkp.md": FLOW, "graphs/graphs.mkp": GRAPHS},
         solution="mkp check --pack graphs release-flow.mkp.md && echo yes > answer.txt", check="answer_is yes"),
    dict(id="10-no-flags-needed", area="check", goal="I'm tired of telling mkp about the graphs pack every time I check release-flow.mkp.md. Set this folder up so a plain `mkp check release-flow.mkp.md` just works.",
         files={"release-flow.mkp.md": FLOW, "graphs/graphs.mkp": GRAPHS}, solution="printf 'packs = [\"graphs\"]\\n' > mkp.toml",
         check="unchanged release-flow.mkp.md graphs/graphs.mkp; mkp check release-flow.mkp.md >/dev/null 2>&1 || fail 'mkp check release-flow.mkp.md still fails without flags'"),
    dict(id="11-complaint-code", area="check", goal="mkp check passes on tidy.mkp.md but complains about something. What's the complaint's code? answer.txt.", files={"tidy.mkp.md": TIDY},
         solution="echo layout.brace > answer.txt", check="unchanged tidy.mkp.md; answer_is layout.brace"),
    dict(id="12-report-via-mkp", area="check", goal="Save the plain-text check report for broken.mkp.md into report.txt, using mkp itself to write the file rather than shell redirection.", files={"broken.mkp.md": BROKEN},
         solution="mkp check broken.mkp.md --out report.txt; true", check="grep -q 'error\\[names.unknown-field\\]' report.txt || fail 'report.txt is not the check report'"),
    dict(id="13-pages-with-errors", area="check", goal="Check every document under pages/ in one go and tell me how many of them have errors (answer.txt).",
         files={"pages/counter.mkp.md": COUNTER, "pages/broken.mkp.md": BROKEN, "pages/notes.mkp.md": ALSO_BROKEN}, solution="echo 2 > answer.txt", check="answer_is 2"),
    # ---- parsing
    dict(id="14-syntax-where", area="parse", goal="Where exactly is the syntax error in bad.mkp? Write it as line:column in answer.txt.", files={"bad.mkp": SYNTAX_BAD},
         solution="echo 3:17 > answer.txt", check="answer_is \"$(mkp parse bad.mkp 2>&1 >/dev/null | grep -o 'bad.mkp:[0-9]*:[0-9]*' | head -1 | cut -d: -f2-)\""),
    dict(id="15-syntax-tree", area="parse", goal="Dump counter.mkp.md's syntax tree to tree.json.", files={"counter.mkp.md": COUNTER},
         solution="mkp parse counter.mkp.md > tree.json", check="json tree.json; grep -q '\"prose\"' tree.json || fail 'tree.json is not the syntax tree'"),
    # ---- building
    dict(id="16-build-to-dist", area="build", goal="Compile counter.mkp.md for a runtime. I want the result at dist/counter.ir.json.", files={"counter.mkp.md": COUNTER},
         solution="mkdir -p dist && mkp build counter.mkp.md --out dist/counter.ir.json", check="json dist/counter.ir.json; jq_is dist/counter.ir.json '.ir.version' 3"),
    dict(id="17-levels", area="build", goal="What runtime capabilities (levels) does counter.mkp.md need? One per line in answer.txt.", files={"counter.mkp.md": COUNTER},
         solution="printf 'core.draw\\ncore.live\\n' > answer.txt", check="names_are core.draw core.live"),
    dict(id="18-tools-form", area="build", goal="Our editor tooling wants the form of counter.mkp.md where every name is resolved but nothing is lowered. Save it as counter.rir.json.", files={"counter.mkp.md": COUNTER},
         solution="mkp build counter.mkp.md --rir --out counter.rir.json", check="json counter.rir.json; jq_is counter.rir.json '.rir' 1"),
    dict(id="19-build-with-pack", area="build", goal="Build release-flow.mkp.md (it uses graphs/) into flow.ir.json.", files={"release-flow.mkp.md": FLOW, "graphs/graphs.mkp": GRAPHS},
         solution="mkp build release-flow.mkp.md --pack graphs --out flow.ir.json", check="json flow.ir.json; jq_is flow.ir.json '.ir.version' 3"),
    dict(id="20-build-errors-json", area="build", goal="broken.mkp.md won't build. Capture its build errors as JSON in build-errors.jsonl, and nothing else in that file.", files={"broken.mkp.md": BROKEN},
         solution="mkp build broken.mkp.md --format json 2> build-errors.jsonl; true",
         check="jsonl build-errors.jsonl; grep -q '\"type\":\"diagnostic\"' build-errors.jsonl || fail 'no diagnostic in build-errors.jsonl'"),
    dict(id="21-fix-teammates-command", area="flags", goal="A teammate's script runs `mkp build page.mkp.md -o page.ir.json` and it breaks. Make it work, and leave the working command in answer.txt.", files={"page.mkp.md": COUNTER},
         solution="mkp build page.mkp.md --out page.ir.json && echo 'mkp build page.mkp.md --out page.ir.json' > answer.txt",
         check="json page.ir.json; jq_is page.ir.json '.ir.version' 3; grep -q -- '--out' answer.txt || fail 'answer.txt does not hold the working command'"),
    # ---- Markdown
    dict(id="22-plain-markdown", area="md", goal="Make a plain Markdown version of counter.mkp.md that I can paste into a README: counter.md.", files={"counter.mkp.md": COUNTER},
         solution="mkp md counter.mkp.md --out counter.md", check="grep -q 'The count is 0' counter.md || fail 'counter.md is not the page as Markdown'"),
    dict(id="23-starting-count", area="md", goal="What number does counter.mkp.md show for the count when it first loads? answer.txt.", files={"counter.mkp.md": COUNTER},
         solution="echo 0 > answer.txt", check="answer_is 0"),
    dict(id="24-blocks", area="md", goal="I need counter.mkp.md's Markdown as structured blocks, in JSON: blocks.json.", files={"counter.mkp.md": COUNTER},
         solution="mkp md counter.mkp.md --format json --out blocks.json", check="json blocks.json; python3 -I -c 'import json,sys; b=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(b, list) and b and all(isinstance(x, dict) and len(x) == 1 for x in b) and any(\"heading\" in x for x in b) else 1)' blocks.json || fail 'blocks.json is not the Markdown as a list of blocks'"),
    # ---- surfaces
    dict(id="25-release-pack", area="surface", goal="The shelf pack goes out as version 1 today. Do whatever mkp expects for a release.", files={"shelf/shelf.mkp": C["SHELF"]},
         solution="mkp surface shelf", check="[ -f shelf/surfaces/shelf@1.mkp ] || fail 'no surface for shelf@1'; mkp surface shelf --check >/dev/null 2>&1 || fail 'the surface is not current'"),
    dict(id="26-promise-kept", area="surface", goal="Has the shelf pack changed what it promised in its released version? answer.txt: yes or no.",
         files={"shelf/shelf.mkp": SHELF_CHANGED, "shelf/surfaces/shelf@1.mkp": "SURFACE_OF_SHELF"}, solution="echo yes > answer.txt", check="unchanged shelf/shelf.mkp; answer_is yes"),
    dict(id="27-current-promise", area="surface", goal="Show me what kit currently promises, as a file kit-promise.mkp, without writing anything into the kit folder.", files=kit(),
         solution="mkp surface kit --stdout > kit-promise.mkp", check="head -1 kit-promise.mkp | grep -q '^package kit@2;' || fail 'kit-promise.mkp is not kit@2s surface'; [ ! -e kit/surfaces/kit@2.mkp ] || fail 'something was written into kit/'"),
    dict(id="28-surface-current", area="surface", goal="Is shelf's recorded release surface up to date? Don't change anything. answer.txt: yes or no.", files={"shelf/shelf.mkp": C["SHELF"]},
         solution="echo no > answer.txt", check="answer_is no; [ ! -e shelf/surfaces ] || fail 'something was written into shelf/'"),
    # ---- migrating packs
    dict(id="29-what-gets-dropped", area="migrate", goal="My docs are on an older kit than the one in this folder. Without changing anything, tell me how many things the newer kit drops from them: just the number, on one line of answer.txt.", files=kit(),
         solution="echo 2 > answer.txt", check="unchanged docs/report.mkp.md mkp.toml; answer_is 2"),
    dict(id="30-bring-up-to-date", area="migrate", goal="Bring the docs up to the kit in this folder.", files=kit(), solution="mkp migrate docs --yes",
         check="grep -q '@plot(' docs/report.mkp.md || fail 'the document was not migrated'; mkp check docs/report.mkp.md >/dev/null 2>&1 || fail 'the document does not compile'; grep -q 'kit = 2' mkp.toml || fail 'mkp.toml still says kit = 1'"),
    dict(id="31-migration-diff", area="migrate", goal="I want to review the migration as a diff before anything changes. Save it as migrate.diff.", files=kit(), solution="mkp migrate docs --diff > migrate.diff",
         check="unchanged docs/report.mkp.md mkp.toml; grep -q '^+@plot' migrate.diff || fail 'migrate.diff does not show the change'"),
    dict(id="32-preview", area="migrate", goal="Show me what docs/report.mkp.md would look like after migrating; put it in preview.mkp.md, but don't change the original.", files=kit(),
         solution="mkp migrate docs/report.mkp.md --stdout > preview.mkp.md", check="unchanged docs/report.mkp.md mkp.toml; grep -q '@plot(' preview.mkp.md || fail 'preview.mkp.md is not the migrated document'"),
    dict(id="33-ci-gate", area="migrate", goal="Our CI must fail while any document still needs migrating. Find the command, check that it fails here right now, and put it in answer.txt.", files=kit(),
         solution="mkp migrate --check; echo 'mkp migrate --check' > answer.txt",
         # the gate itself: it fails on this tree, and passes on the same tree once migrated
         check="unchanged docs/report.mkp.md mkp.toml; cmd=$(answer | head -1); [ -n \"$cmd\" ] || fail 'answer.txt holds no command'; t=$(mktemp -d); cp -r . \"$t/stale\"; (cd \"$t/stale\" && sh -c \"$cmd\" >/dev/null 2>&1) && fail \"$cmd passes on a tree that needs migrating\"; cp -r . \"$t/done\"; (cd \"$t/done\" && mkp migrate --yes --allow-dirty >/dev/null 2>&1); (cd \"$t/done\" && sh -c \"$cmd\" >/dev/null 2>&1) || fail \"$cmd still fails once the tree is migrated\"; rm -rf \"$t\""),
    dict(id="34-written-record", area="migrate", goal="Migrate the docs and keep a written record of what happened in migration-report.md: writing that file is part of the task.", files=kit(), solution="mkp migrate docs --yes --report migration-report.md",
         check="grep -q '@plot(' docs/report.mkp.md || fail 'the document was not migrated'; grep -q '^# mkp migrate' migration-report.md || fail 'migration-report.md is not the report'"),
    dict(id="35-plan-for-a-bot", area="migrate", goal="Same as a dry run, but as JSON lines for a bot: plan.jsonl.", files=kit(), solution="mkp migrate docs --dry-run --format json > plan.jsonl",
         check="unchanged docs/report.mkp.md mkp.toml; jsonl plan.jsonl; last_type plan.jsonl summary"),
    dict(id="36-answer-the-questions", area="migrate", goal="Migrate the docs. Make kit@1's badges small, but leave every chart's tone as it is.", files=kit(migration=MIG_Q), solution="mkp migrate docs --yes 1",
         check="grep -q '@badge(label = \"Beta\", size = size.S);' docs/report.mkp.md || fail 'the badge is not small'; grep -q '@plot(values = \\[1, 2\\], tone = color.OK);' docs/report.mkp.md || fail 'the chart lost its tone, or was not migrated'"),
    dict(id="37-unattended-choice", area="migrate", goal="Migrate the docs. Wherever the old LATE state appears, it should become DONE. Nobody will be at a keyboard when this runs.", files=kit(migration=MIG_SPLIT),
         solution="printf '[split]\\n\"docs/report.mkp.md:4 LATE\" = \"DONE\"\\n' > answers.toml && mkp migrate docs --yes --answers answers.toml",
         check="grep -q 's: state = state.DONE;' docs/report.mkp.md || fail 'LATE did not become DONE'"),
    dict(id="38-leave-a-marker", area="migrate", goal="Migrate the docs even though there's a decision only a person can make. Leave a clear marker for them in the file, and let the file be written anyway.", files=kit(migration=MIG_SPLIT),
         solution="mkp migrate docs --yes --allow-todos --allow-errors; true", check="grep -q 'TODO(mkp migrate)' docs/report.mkp.md || fail 'no TODO left in the document'; grep -q '@plot(' docs/report.mkp.md || fail 'the rest was not migrated'"),
    dict(id="39-record-the-release", area="migrate", goal="This tree has been fully migrated already, but mkp.toml doesn't say which mkp release it's written for. Fix that, using mkp.",
         files=kit(doc=MIGRATED, toml='packs = ["kit"]\n\n[uses]\nkit = 2\n'), solution="mkp migrate docs --yes",
         check="unchanged docs/report.mkp.md; grep -q '^mkp = \"0.3.0\"' mkp.toml || fail 'mkp.toml does not record the release'"),
    dict(id="40-refuses-to-run", area="migrate", goal="mkp migrate refuses to do anything in this folder. Figure out why, make it work, and migrate the docs.", files=kit(toml='mkp = "9.0.0"\npacks = ["kit"]\n\n[uses]\nkit = 1\n'),
         solution="sed -i 's/9.0.0/0.3.0/' mkp.toml && mkp migrate docs --yes", check="grep -q '@plot(' docs/report.mkp.md || fail 'the document was not migrated'"),
    dict(id="41-no-config", area="migrate", goal="The kit pack is in ./kit, and the document was written for its version 1. There's no config file. Migrate the document.", files=kit(toml=None),
         solution="mkp migrate docs --pack kit --yes", check="grep -q '@plot(' docs/report.mkp.md || fail 'the document was not migrated'; mkp check --pack kit docs/report.mkp.md >/dev/null 2>&1 || fail 'the document does not compile'"),
    dict(id="42-packs-that-use-kit", area="migrate", goal="Other packs here use kit too. Bring everything, the dash pack and the docs, up to the new kit.",
         files={**kit(doc="import dash;\n@@@\n@summary(n = 3);\n", toml='packs = ["kit", "dash"]\n'), "dash/dash.mkp": DASH}, solution="mkp migrate docs --yes",
         check="grep -q 'uses core@1, kit@2;' dash/dash.mkp || fail 'dash still uses kit@1'; grep -q '@plot(values = \\[n\\], tone = color.OK);' dash/dash.mkp || fail 'dash was not migrated'"),
    dict(id="43-dirty-tree", area="migrate", goal="docs/ is in git, and someone has uncommitted edits in report.mkp.md. Migrate the docs anyway. This runs in a script, with no terminal.", files=kit(),
         setup="git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm base && printf '\\n' >> docs/report.mkp.md",
         solution="mkp migrate docs --yes --allow-dirty", check="grep -q '@plot(' docs/report.mkp.md || fail 'the document was not migrated'"),
    dict(id="44-example-holds", area="migrate", goal="Does the example in kit's migration actually hold? answer.txt: yes or no.", files=kit(migration=MIG_BAD_EXAMPLE), solution="echo no > answer.txt",
         check="unchanged kit/migrations/kit@2.mkp; answer_is no"),
    # ---- MKP 0.2
    dict(id="45-find-the-old-ones", area="0.2", goal="Which of the documents in docs/ were written for MKP 0.2? List their file names in answer.txt.",
         files={"docs/counter.mkp.md": C["COUNTER_02"], "docs/notes.mkp.md": "# Notes\n\nPlain text.\n", "docs/page.mkp.md": COUNTER}, solution="echo counter.mkp.md > answer.txt",
         check="unchanged docs/counter.mkp.md docs/notes.mkp.md docs/page.mkp.md; names_are counter.mkp.md"),
    dict(id="46-old-page", area="0.2", goal="counter.mkp.md is an old MKP 0.2 page. Bring it into MKP 0.3.", files={"counter.mkp.md": C["COUNTER_02"]}, solution="mkp migrate counter.mkp.md --yes",
         check="grep -q 'widget counter(' counter.mkp.md || fail 'counter.mkp.md is not 0.3'; mkp check counter.mkp.md >/dev/null 2>&1 || fail 'counter.mkp.md does not compile'"),
    dict(id="47-old-pack-stand-in", area="0.2", goal="runs.mkp.md is MKP 0.2 and uses the old units pack in old/units, which has no 0.3 version yet. Get runs.mkp.md onto 0.3 anyway; something standing in for the pack is fine.",
         files={"runs.mkp.md": C["RUNS_02"], "old/units/manifest.mkp": C["UNITS_02_MANIFEST"], "old/units/distance.mkp": C["UNITS_02_DISTANCE"]},
         solution="mkp migrate runs.mkp.md --pack old/units --yes --allow-todos; true",
         check="grep -q 'import units;' runs.mkp.md || fail 'runs.mkp.md is not 0.3'; s=$(find . -path ./old -prune -o -name units.mkp -print | head -1); [ -n \"$s\" ] || fail 'no stand-in for units'; mkp check --pack \"$(dirname \"$s\")\" runs.mkp.md >/dev/null 2>&1 || fail 'runs.mkp.md does not compile with the stand-in'"),
    dict(id="48-old-page-new-pack", area="0.2", goal="runs.mkp.md is an MKP 0.2 page that uses the old units pack in old/units; the 0.3 version of units is in ./units. Move runs.mkp.md to 0.3 using it, with no stand-ins.",
         files={"runs.mkp.md": C["RUNS_02"], "old/units/manifest.mkp": C["UNITS_02_MANIFEST"], "old/units/distance.mkp": C["UNITS_02_DISTANCE"], "units/units.mkp": UNITS_03},
         solution="mkp migrate runs.mkp.md --pack old/units,units --yes",
         check="grep -q 'import units;' runs.mkp.md || fail 'runs.mkp.md is not 0.3'; [ -z \"$(find . -name stand-ins)\" ] || fail 'a stand-in was written'; mkp check --pack units runs.mkp.md >/dev/null 2>&1 || fail 'runs.mkp.md does not compile with units'"),
    # ---- target checks
    dict(id="49-conformance-count", area="target", goal="Run the conformance checks against just the 'test' target and tell me how many cases it ran (answer.txt).", files={},
         solution="mkp target check test --format json | grep '\"type\":\"target\"' | grep -o '\"cases\":[0-9]*' | cut -d: -f2 > answer.txt",
         check="answer_is \"$(mkp target check test --format json | grep '\"type\":\"target\"' | grep -o '\"cases\":[0-9]*' | cut -d: -f2)\""),
    dict(id="50-catch-a-defect", area="target", goal="Prove the conformance checks would catch a broken target: use the test target's no-undo defect, and write caught or missed in answer.txt.", files={},
         solution="mkp target check test --defect no-undo --expect-failures && echo caught > answer.txt", check="answer_is caught"),
]

PRELUDE = r'''#!/usr/bin/env bash
# The check of one task: run in its sandbox, with mkp on PATH. Exit 0: done.
cd "$1" || exit 2
fail() { echo "FAIL: $*"; exit 1; }
answer() { [ -f answer.txt ] || fail "no answer.txt"; tr -d '\r' < answer.txt | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$'; }
answer_is() { [ "$(answer | tr 'A-Z' 'a-z' | head -1)" = "$(echo "$1" | tr 'A-Z' 'a-z')" ] && [ "$(answer | wc -l)" = 1 ] || fail "answer.txt says '$(answer | head -3 | tr '\n' ' ')', not '$1'"; }
names_are() { want=$(printf '%s\n' "$@" | sort); got=$(answer | sed 's#.*/##' | sort -u); [ "$got" = "$want" ] || fail "answer.txt names '$(echo $got)', not '$(echo $want)'"; }
json() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null || fail "$1 is not JSON"; }
jsonl() { [ -s "$1" ] || fail "$1 is missing or empty"; python3 -c 'import json,sys; [json.loads(l) for l in open(sys.argv[1]) if l.strip()]' "$1" 2>/dev/null || fail "$1 is not JSON lines"; }
last_type() { python3 -c 'import json,sys; ls=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; sys.exit(0 if ls and ls[-1].get("type")==sys.argv[2] else 1)' "$1" "$2" || fail "$1 does not end with its $2"; }
jq_is() { got=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); p=sys.argv[2].strip(".").split("."); [d:=d[k] for k in p]; print(d)' "$1" "$2" 2>/dev/null); [ "$got" = "$3" ] || fail "$1: $2 is '$got', not '$3'"; }
'''


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def write_task(t, root):
    """The task's sandbox, as given to the agent."""
    d = root / "tasks" / t["id"]
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    for rel, text in t["files"].items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if text == "SURFACE_OF_SHELF":
            # the surface of shelf as released: from the unchanged pack, by mkp itself
            tmp = root / "scratch-shelf"
            shutil.rmtree(tmp, ignore_errors=True)
            (tmp / "shelf").mkdir(parents=True)
            (tmp / "shelf/shelf.mkp").write_text(C["SHELF"])
            subprocess.run([str(MKP), "surface", "shelf"], cwd=tmp, check=True, capture_output=True)
            text = (tmp / "shelf/surfaces/shelf@1.mkp").read_text()
            shutil.rmtree(tmp)
        p.write_text(text)
    if t.get("setup"):
        subprocess.run(t["setup"], shell=True, cwd=d, check=True, capture_output=True)
    return d


def write_check(t, root, d):
    """The check, with what each file the task must leave alone holds."""
    body = t["check"]
    def unchanged(m):
        lines = []
        for rel in m.group(1).split():
            lines.append(f'[ "$(sha256sum {rel} 2>/dev/null | cut -d" " -f1)" = "{hashlib.sha256((d / rel).read_bytes()).hexdigest()}" ] || fail "{rel} was changed"')
        return "; ".join(lines)
    body = re.sub(r"unchanged ([^;]+)", unchanged, body)
    p = root / "checks" / f"{t['id']}.sh"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(PRELUDE + body + '\necho "PASS"\n')
    p.chmod(0o755)
    return p


def env():
    e = dict(os.environ)
    e["PATH"] = f"{MKP.parent}:{e['PATH']}"
    return e


def run_check(p, d):
    r = subprocess.run(["bash", str(p), str(d)], capture_output=True, text=True, env=env(), timeout=600)
    return r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]


def make(root):
    root = Path(root).resolve()
    tasks = []
    for t in TASKS:
        d = write_task(t, root)
        p = write_check(t, root, d)
        tasks.append({"id": t["id"], "area": t["area"], "goal": t["goal"], "dir": str(d), "check": str(p)})
    (root / "tasks.json").write_text(json.dumps(tasks, indent=1) + "\n")
    print(f"{len(tasks)} tasks in {root}/tasks, checks in {root}/checks, the list in {root}/tasks.json")


def selftest(root):
    root = Path(root).resolve()
    bad = 0
    for t in TASKS:
        d = write_task(t, root / "selftest")
        p = write_check(t, root / "selftest", d)
        before, why_before = run_check(p, d)
        subprocess.run(t["solution"], shell=True, cwd=d, env=env(), capture_output=True, timeout=600)
        after, why_after = run_check(p, d)
        ok = not before and after
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {t['id']:28} untouched: {'passes' if before else 'fails'}; solved: {'passes' if after else 'fails: ' + why_after[0]}")
    print(f"{len(TASKS) - bad} of {len(TASKS)} checks are right")
    return bad == 0


def check(root):
    root = Path(root).resolve()
    tasks = json.loads((root / "tasks.json").read_text())
    results = []
    for t in tasks:
        passed, why = run_check(Path(t["check"]), Path(t["dir"]))
        results.append({"id": t["id"], "passed": passed, "why": why[0]})
        print(f"{'PASS' if passed else 'FAIL'} {t['id']:28} {why[0] if not passed else ''}")
    (root / "results.json").write_text(json.dumps(results, indent=1) + "\n")
    print(f"{sum(r['passed'] for r in results)} of {len(results)} passed")


if __name__ == "__main__":
    cmd, root = sys.argv[1], sys.argv[2]
    ok = {"make": make, "selftest": selftest, "check": check}[cmd](root)
    sys.exit(0 if ok is not False else 1)
