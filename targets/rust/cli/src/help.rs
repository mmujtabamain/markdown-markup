//! What `xtmd`, `xtmd --help` and `xtmd <command> --help` print: the commands, and each one's flags,
//! what it prints where, its exit codes and an example.

/// `xtmd` with no command, `xtmd --help` and `xtmd help`.
pub(crate) const TOP: &str = "xtmd, the Extended Mark 0.3 compiler.

usage: xtmd <command> [arguments] [flags]
  xtmd fmt <file|folder>…        rewrite each file in the canonical layout, in place (the formatter)
  xtmd check <file|folder>…      report every error and warning, then a line for each file
  xtmd parse <file>              print a file's syntax tree, as JSON
  xtmd build <file>              write a document's IR, for a runtime (--rir: the resolved IR, for tools)
  xtmd md <file>                 write a document's Markdown, as it reads when it first loads
  xtmd surface <pack>            the release step: record what this version of the pack provides
  xtmd migrate [<file|folder>…]  bring documents and packs up to the packs they are built with
  xtmd target check [target…]    run the conformance cases on targets, through their check adapters
  xtmd lsp                       the language server, for an editor: the protocol over stdin and stdout
  xtmd help <command>, or xtmd <command> --help: that command's flags, exit codes and an example
  xtmd --version: this xtmd's release

Every command takes:
  --format json  JSON instead of text. A command that writes a document (build, md, parse) writes
                 it as JSON, with its diagnostics as JSON lines on stderr. One that reports (check,
                 fmt, surface, migrate, target check) prints JSON lines: one object a line, each with
                 its \"type\", and a \"summary\" last.
  --out <file>   what it prints goes to the file, its folder made if need be (build, md and surface
                 write their document there); a run that stops at a usage error leaves it alone.
  --help         its own usage.
And check, build, md, surface and migrate take:
  --pack a,b     the packs: folders and .xtpack files.
  --config f     an xtmd.toml; left out, xtmd looks for one in the file's folder and the folders above.
                 It says packs = [\"kit\", \"extra.xtpack\"] (as --pack does), xtmd = \"0.3.0\" (the release
                 of xtmd the tree is written for) and, under [uses], kit = 2 (each pack's version).

Exit codes: 0 done, nothing wrong; 1 something is wrong (an error, a file that would change, a
check that failed); 2 a usage error, or a file that can't be read.
A flag a command doesn't know is warned about and ignored, but a run that would write files then
writes nothing.";

const FMT: &str = "usage: xtmd fmt <file|folder>… [--check | --diff | --stdout] [--out file] [--format json]
       xtmd fmt --stdin <file> [--check | --diff] [--format json]
  Rewrites each file in the canonical layout, in place, and says what it did: the standard
  formatter. A folder means every .xtpack and .xt.md file under it.
  --check        writes nothing: names each file that isn't in the canonical layout, and fails
  --diff         writes nothing: prints each change as a unified diff (with --check, it fails too)
  --stdout       writes nothing: prints one file in the canonical layout
  --stdin        formats the text on stdin instead, for an editor whose text isn't saved: the file
                 named says what it is (.xt.md or .xtpack) and is never read or written; the text
                 goes to stdout, or with --check and --diff, whether and how it would change
  --out f        alone: writes one file's canonical text to f, and leaves the file as it was;
                 with --check or --diff, what they print goes to f
  --format json  a JSON line for each file ({\"type\":\"file\",\"result\":\"canonical\"|\"formatted\"|
                 \"would change\"|…}), and a summary last
  The verdicts go to stderr, so --stdout and --diff print only the text.
  exit: 0 done, or nothing to change; 1 a file would change (--check) or doesn't read;
        2 a usage error, or a file that can't be read
  e.g.  xtmd fmt page.xt.md
        xtmd fmt --check src/
        xtmd fmt page.xt.md --out tidy.xt.md
        xtmd fmt --stdin page.xt.md < draft.xt.md";

const CHECK: &str = "usage: xtmd check <file|folder>… [--pack a,b] [--config xtmd.toml] [--out file] [--format json]
  Reports every error and warning in each file, then a line for each file and, for several, a
  total. A document's line names the levels it needs to run (core.draw, core.live, core.gfx).
  A folder means every Extended Mark file under it. A pack's file is checked with the rest of its pack,
  against the surfaces it has released (surfaces/name@N.xtpack), and its migrations' examples are run.
  A document that looks like MKP 0.2's gets a warning: xtmd migrate brings it to 0.3.
  --pack a,b     the packs the files use (or packs = [...] in xtmd.toml)
  --out f        the report goes to f instead of stderr
  --format json  JSON lines on stdout: one for each diagnostic ({\"type\":\"diagnostic\",\"code\",
                 \"severity\",\"line\",\"column\",\"message\",\"fix\"}, and \"edits\" where the fix is
                 exactly one: [{\"line\",\"column\",\"end\",\"text\"}], what an editor writes), one for each
                 file ({\"type\":\"file\",\"result\":\"clean\"|\"warnings\"|\"errors\"|\"not read\",\"levels\"}),
                 and a summary last
  exit: 0 no errors (warnings are fine); 1 errors; 2 a usage error, or a file that can't be read
  e.g.  xtmd check docs/
        xtmd check --pack graphs flow.xt.md --format json --out problems.jsonl";

const PARSE: &str = "usage: xtmd parse <file> [--out tree.json] [--format json]
  Prints one file's syntax tree, as JSON, to stdout (or --out); its syntax errors go to stderr,
  as JSON lines with --format json.
  exit: 0 it parses; 1 it has syntax errors; 2 a usage error, or a file that can't be read
  e.g.  xtmd parse page.xt.md --out tree.json";

const LSP: &str = "usage: xtmd lsp
  The language server, for an editor: it speaks the Language Server Protocol over stdin and
  stdout, and an editor starts it. It gives each open document's errors as it is edited, hover,
  go to definition, references, the outline, completion and formatting, worked out from the
  same checker xtmd check runs, with core's own declarations. A document's packs are the ones its
  xtmd.toml names, read from disk, unless the editor gives them (xtmd/packs).
  It takes no flags but --help. Editors: ide/vscode, and ide/lsp's README for the rest.
  exit: 0 after the editor's shutdown and exit; 1 when the input ends first
  e.g.  xtmd lsp";

const BUILD: &str = "usage: xtmd build <file> [--pack a,b] [--config xtmd.toml] [--rir [--core]] [--out out.ir.json] [--format json]
  Writes a document's IR, what a runtime draws: the document, and only what it uses of core and
  its packs. The IR's top-level \"levels\" are what the page needs.
  --rir          the resolved IR instead: every name and type resolved and nothing lowered, for
                 editor tools (schemas/rir.schema.json); its \"levels\" are the document's too
  --core         with --rir: core's own files first, resolved too, for an editor that completes
                 core's widgets and goes to their declarations
  --out f        writes it to f, its folder made if need be; without it, it goes to stdout
  --format json  its errors as JSON lines on stderr
  exit: 0 written; 1 it doesn't compile; 2 a usage error, or a file that can't be read
  e.g.  xtmd build page.xt.md --out dist/page.ir.json";

const MD: &str = "usage: xtmd md <file> [--pack a,b] [--config xtmd.toml] [--out out.md] [--format json]
  Writes a document's Markdown, as the page reads when it first loads: each value at its start,
  each widget as its pack writes it in Markdown (a button as its label; a widget whose pack writes
  no Markdown is left out).
  --out f        writes it to f, its folder made if need be; without it, it goes to stdout
  --format json  the same page as a JSON list of blocks, each named by its kind ({\"heading\": …},
                 {\"paragraph\": …}), as the checks read it
  exit: 0 written; 1 it doesn't compile; 2 a usage error, or a file that can't be read
  e.g.  xtmd md page.xt.md --out README.md";

const SURFACE: &str = "usage: xtmd surface <pack folder|file> [--pack a,b] [--check | --diff | --stdout] [--out file] [--force] [--format json]
  The release step. Writes what this version of the pack provides, its surface, to
  <pack folder>/surfaces/<name>@<version>.xtpack (the version is the pack block's: pack kit@2).
  Commit it: a later version is held to it, and its migration starts from it.
  --check        writes nothing: fails if the surface is missing or out of date, or the pack
                 breaks one it has released
  --diff         writes nothing: shows how the surface would change; --stdout prints it
  --out f        writes the surface to f instead of into the pack folder
  --force        replaces a recorded surface that differs (only for a version not yet released)
  --pack a,b     the packs this pack uses
  exit: 0 written, or up to date; 1 missing, out of date, broken or doesn't compile; 2 a usage error
  e.g.  xtmd surface kit
        xtmd surface kit --check";

const TARGET_CHECK: &str = "usage: xtmd target check [target…] [--cases dir] [--defect name [--expect-failures]] [--require target:name] [--out file] [--format json]
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
  e.g.  xtmd target check test
        xtmd target check test --defect no-undo --expect-failures";

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
        "lsp" => LSP,
        _ => return None,
    })
}
