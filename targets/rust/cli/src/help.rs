//! What `mkp`, `mkp --help` and `mkp <command> --help` print: the commands, and each one's flags,
//! what it prints where, its exit codes and an example.

/// `mkp` with no command, `mkp --help` and `mkp help`.
pub(crate) const TOP: &str = "mkp, the MKP 0.3 compiler.

usage: mkp <command> [arguments] [flags]
  mkp fmt <file|folder>…        rewrite each file in the canonical layout, in place (the formatter)
  mkp check <file|folder>…      report every error and warning, then a line for each file
  mkp parse <file>              print a file's syntax tree, as JSON
  mkp build <file>              write a document's IR, for a runtime (--rir: the resolved IR, for tools)
  mkp md <file>                 write a document's Markdown, as it reads when it first loads
  mkp surface <pack>            the release step: record what this version of the pack provides
  mkp migrate [<file|folder>…]  bring documents and packs up to the packs they are built with
  mkp target check [target…]    run the conformance cases on targets, through their check adapters
  mkp help <command>, or mkp <command> --help: that command's flags, exit codes and an example
  mkp --version: this mkp's release

Every command takes:
  --format json  JSON instead of text. A command that writes a document (build, md, parse) writes
                 it as JSON, with its diagnostics as JSON lines on stderr. One that reports (check,
                 fmt, surface, migrate, target check) prints JSON lines: one object a line, each with
                 its \"type\", and a \"summary\" last.
  --out <file>   what it prints goes to the file, its folder made if need be (build, md and surface
                 write their document there); a run that stops at a usage error leaves it alone.
  --help         its own usage.
And check, build, md, surface and migrate take:
  --pack a,b     the packs: folders and .mkp files.
  --config f     an mkp.toml; left out, mkp looks for one in the file's folder and the folders above.
                 It says packs = [\"kit\", \"extra.mkp\"] (as --pack does), mkp = \"0.3.0\" (the release
                 of mkp the tree is written for) and, under [uses], kit = 2 (each pack's version).

Exit codes: 0 done, nothing wrong; 1 something is wrong (an error, a file that would change, a
check that failed); 2 a usage error, or a file that can't be read.
A flag a command doesn't know is warned about and ignored, but a run that would write files then
writes nothing.";

const FMT: &str = "usage: mkp fmt <file|folder>… [--check | --diff | --stdout] [--out file] [--format json]
  Rewrites each file in the canonical layout, in place, and says what it did: the standard
  formatter. A folder means every .mkp and .mkp.md file under it.
  --check        writes nothing: names each file that isn't in the canonical layout, and fails
  --diff         writes nothing: prints each change as a unified diff (with --check, it fails too)
  --stdout       writes nothing: prints one file in the canonical layout
  --out f        alone: writes one file's canonical text to f, and leaves the file as it was;
                 with --check or --diff, what they print goes to f
  --format json  a JSON line for each file ({\"type\":\"file\",\"result\":\"canonical\"|\"formatted\"|
                 \"would change\"|…}), and a summary last
  The verdicts go to stderr, so --stdout and --diff print only the text.
  exit: 0 done, or nothing to change; 1 a file would change (--check) or doesn't read;
        2 a usage error, or a file that can't be read
  e.g.  mkp fmt page.mkp.md
        mkp fmt --check src/
        mkp fmt page.mkp.md --out tidy.mkp.md";

const CHECK: &str = "usage: mkp check <file|folder>… [--pack a,b] [--config mkp.toml] [--out file] [--format json]
  Reports every error and warning in each file, then a line for each file and, for several, a
  total. A document's line names the levels it needs to run (core.draw, core.live, core.gfx).
  A folder means every MKP file under it. A pack's file is checked with the rest of its pack,
  against the surfaces it has released (surfaces/name@N.mkp), and its migrations' examples are run.
  A document that looks like MKP 0.2's gets a warning: mkp migrate brings it to 0.3.
  --pack a,b     the packs the files use (or packs = [...] in mkp.toml)
  --out f        the report goes to f instead of stderr
  --format json  JSON lines on stdout: one for each diagnostic ({\"type\":\"diagnostic\",\"code\",
                 \"severity\",\"line\",\"column\",\"message\",\"fix\"}), one for each file ({\"type\":\"file\",
                 \"result\":\"clean\"|\"warnings\"|\"errors\"|\"not read\",\"levels\"}), and a summary last
  exit: 0 no errors (warnings are fine); 1 errors; 2 a usage error, or a file that can't be read
  e.g.  mkp check docs/
        mkp check --pack graphs flow.mkp.md --format json --out problems.jsonl";

const PARSE: &str = "usage: mkp parse <file> [--out tree.json] [--format json]
  Prints one file's syntax tree, as JSON, to stdout (or --out); its syntax errors go to stderr,
  as JSON lines with --format json.
  exit: 0 it parses; 1 it has syntax errors; 2 a usage error, or a file that can't be read
  e.g.  mkp parse page.mkp.md --out tree.json";

const BUILD: &str = "usage: mkp build <file> [--pack a,b] [--config mkp.toml] [--rir] [--out out.ir.json] [--format json]
  Writes a document's IR, what a runtime draws: the document, and only what it uses of core and
  its packs. The IR's top-level \"levels\" are what the page needs.
  --rir          the resolved IR instead: every name and type resolved and nothing lowered, for
                 editor tools (schemas/rir.schema.json); its \"levels\" are the document's too
  --out f        writes it to f, its folder made if need be; without it, it goes to stdout
  --format json  its errors as JSON lines on stderr
  exit: 0 written; 1 it doesn't compile; 2 a usage error, or a file that can't be read
  e.g.  mkp build page.mkp.md --out dist/page.ir.json";

const MD: &str = "usage: mkp md <file> [--pack a,b] [--config mkp.toml] [--out out.md] [--format json]
  Writes a document's Markdown, as the page reads when it first loads: each value at its start,
  each widget as its pack writes it in Markdown (a button as its label; a widget whose pack writes
  no Markdown is left out).
  --out f        writes it to f, its folder made if need be; without it, it goes to stdout
  --format json  the same page as a JSON list of blocks, each named by its kind ({\"heading\": …},
                 {\"paragraph\": …}), as the checks read it
  exit: 0 written; 1 it doesn't compile; 2 a usage error, or a file that can't be read
  e.g.  mkp md page.mkp.md --out README.md";

const SURFACE: &str = "usage: mkp surface <pack folder|file> [--pack a,b] [--check | --diff | --stdout] [--out file] [--force] [--format json]
  The release step. Writes what this version of the pack provides, its surface, to
  <pack folder>/surfaces/<name>@<version>.mkp (the version is the pack block's: pack kit@2).
  Commit it: a later version is held to it, and its migration starts from it.
  --check        writes nothing: fails if the surface is missing or out of date, or the pack
                 breaks one it has released
  --diff         writes nothing: shows how the surface would change; --stdout prints it
  --out f        writes the surface to f instead of into the pack folder
  --force        replaces a recorded surface that differs (only for a version not yet released)
  --pack a,b     the packs this pack uses
  exit: 0 written, or up to date; 1 missing, out of date, broken or doesn't compile; 2 a usage error
  e.g.  mkp surface kit
        mkp surface kit --check";

const TARGET_CHECK: &str = "usage: mkp target check [target…] [--cases dir] [--defect name [--expect-failures]] [--require target:name] [--out file] [--format json]
  Runs the conformance cases through each target's check adapter, and reports every difference
  from a case and between targets. The targets are each target.yaml under targets/: android,
  egui, native, test and web, and react, vue, svelte, solid and angular, each also as -live
  (react-live…), which compiles every case's text in the browser. With none named, it runs
  every one, which takes minutes. It says where the cases come from.
  --cases dir         the cases to run (default: targets/checks/cases in the repository)
  --defect name       runs the targets with one of their defects switched on, to show the cases
                      catch it; a name the target doesn't have stops the run, listing the ones it has
  --expect-failures   with --defect: exit 0 when the defect is caught, 1 when it is missed
  --require t:name    fails first if target t can't supply name (as in web:core/math)
  exit: 0 nothing differs (or the defect was caught); 1 something differs (or it was missed);
        2 a usage error: an unknown target, a missing --cases folder, an adapter that won't start
  e.g.  mkp target check test
        mkp target check test --defect no-undo --expect-failures";

/// A command's own usage, or none for a name that isn't one.
pub(crate) fn of(cmd: &str) -> Option<&'static str> {
    Some(match cmd {
        "fmt" => FMT,
        "check" => CHECK,
        "parse" => PARSE,
        "build" => BUILD,
        "md" => MD,
        "surface" => SURFACE,
        "migrate" => crate::migrate::USAGE,
        "target check" | "target" => TARGET_CHECK,
        _ => return None,
    })
}
