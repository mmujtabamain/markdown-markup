//! The flags each command takes. One a command doesn't know is a warning, and it is ignored; one a
//! release of mkp dropped fails, saying what replaced it.

/// Each command's flags; one that takes a value takes it as the next argument or after `=`.
fn known(cmd: &str) -> &'static [&'static str] {
    // every command takes --format and --out (page 1 of `mkp`'s usage); one spelling each
    match cmd {
        "fmt" => &["--check", "--diff", "--stdout", "--format", "--out"],
        "parse" => &["--format", "--out"],
        "check" => &["--pack", "--config", "--format", "--out"],
        "build" => &["--rir", "--pack", "--config", "--format", "--out"],
        "md" => &["--pack", "--config", "--format", "--out"],
        "surface" => &["--check", "--diff", "--stdout", "--force", "--pack", "--config", "--format", "--out"],
        "migrate" => &[
            "--pack", "--config", "--from", "--answers", "--format", "--out", "--report", "--dry-run", "--check", "--diff", "--stdout", "--yes", "--allow-dirty", "--allow-errors", "--allow-todos", "--help",
        ],
        "target check" => &["--cases", "--defect", "--expect-failures", "--require", "--format", "--out"],
        _ => &[],
    }
}

/// A flag a release dropped: its command, the flag, the release that dropped it, and what does its
/// work now ("nothing: …" where nothing does, and why). A later release that drops one adds it
/// here. A release of `""` is a flag mkp never had but is asked for, and why it has none.
const DROPPED: &[(&str, &str, &str, &str)] = &[
    ("build", "--target", "0.3.0", "mkp build writes the IR and mkp md the Markdown; drawing HTML is a target's"),
    ("build", "--md", "0.3.0", "mkp md writes CommonMark with GitHub's tables, and has no switches"),
    ("build", "--lock", "0.3.0", "the version of each pack is mkp.toml's [uses]"),
    ("build", "--relock", "0.3.0", "the version of each pack is mkp.toml's [uses], which mkp migrate moves"),
    ("build", "--no-lock", "0.3.0", "there is no lock: the version of each pack is mkp.toml's [uses]"),
    ("build", "--diagnostics", "0.3.0", "use --format json"),
    ("build", "--styles", "0.3.0", "the look is a target's to draw, and mkp writes no HTML"),
    ("build", "--profile", "0.3.0", "nothing: a pack has one surface per version"),
    ("build", "--name", "0.3.0", "nothing: mkp build reads a file, named by its path"),
    ("build", "--compact", "0.3.0", "nothing: the IR is written one way"),
    ("build", "--no-maths", "0.3.0", "nothing: maths is TeX passed to the target, which draws it"),
    ("build", "--no-speech", "0.3.0", "nothing: maths is TeX passed to the target, which draws it"),
    ("build", "--no-answers", "0.3.0", "nothing: mkp md writes a page with its starting values"),
    ("check", "--diagnostics", "0.3.0", "use --format json"),
    ("fmt", "--write", "0.3.0", "mkp fmt writes each file in place; --check only checks"),
    ("migrate", "--write", "0.3.0", "mkp migrate writes in place, asking first in a terminal; elsewhere --yes writes"),
    ("migrate", "--keep", "0.3.0", "a pack's migration asks with confirm, and --yes 1,3 answers its numbered questions (or --answers)"),
    ("migrate", "--take", "0.3.0", "a pack's migration asks with confirm, and --yes answers every question (or --answers)"),
    ("migrate", "--core", "0.3.0", "MKP_MIGRATE_02 names the frozen 0.2 step"),
    ("migrate", "--to", "", "a migration goes one way, to this mkp's release and to the version of each pack in the build"),
    // one spelling for each flag: the short ones mkp 0.3's development had, and the --json it had
    ("build", "-o", "", "use --out"),
    ("md", "-o", "", "use --out"),
    ("surface", "-o", "", "use --out"),
    ("check", "-c", "", "use --config"),
    ("build", "-c", "", "use --config"),
    ("md", "-c", "", "use --config"),
    ("surface", "-c", "", "use --config"),
    ("migrate", "-c", "", "use --config"),
    ("migrate", "-y", "", "use --yes"),
    ("migrate", "-h", "", "use --help"),
    ("check", "--json", "", "use --format json"),
    ("md", "--json", "", "use --format json"),
];

/// Whether a command's flags let it run: each it doesn't know is warned about and ignored, and one a
/// release dropped stops it, with what replaced it.
pub(crate) fn ok(cmd: &str, args: &[String]) -> bool {
    let known = known(cmd);
    let mut ok = true;
    for a in args.iter().filter(|a| a.len() > 1 && a.starts_with('-') && a.trim_start_matches('-').chars().next().map_or(false, |c| c.is_ascii_alphabetic())) {
        let name = a.split_once('=').map_or(a.as_str(), |(n, _)| n);
        if known.contains(&name) {
            continue;
        }
        match DROPPED.iter().find(|(c, f, _, _)| *c == cmd && *f == name) {
            Some((_, _, since, instead)) => {
                match (since.is_empty(), instead.strip_prefix("nothing: ")) {
                    (true, _) => eprintln!("error: mkp {} has no {}: {}", cmd, name, instead),
                    (false, Some(why)) => eprintln!("error: mkp {} dropped {} in mkp {}, and nothing replaces it: {}", cmd, name, since, why),
                    (false, None) => eprintln!("error: mkp {} dropped {} in mkp {}: {}", cmd, name, since, instead),
                }
                ok = false;
            }
            None => eprintln!("warning: mkp {} has no flag {}, so it is ignored", cmd, name),
        }
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_dropped_flag_is_one_its_command_no_longer_takes() {
        for (cmd, flag, since, instead) in DROPPED {
            assert!(!known(cmd).contains(flag), "mkp {} still takes {}", cmd, flag);
            assert!((since.is_empty() || crate::migrate::release_of(since).is_some()) && !instead.is_empty());
        }
    }

    #[test]
    fn an_unknown_flag_is_ignored_and_a_dropped_one_stops_the_command() {
        let args = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(ok("migrate", &args(&["docs", "--yes=1,3", "--pack=kit", "--stdout", "--quiet"])));
        assert!(!ok("migrate", &args(&["docs", "--write"])));
        assert!(!ok("migrate", &args(&["docs", "--to", "0.3.0"])));
        assert!(ok("fmt", &args(&["a.mkp", "--check", "-", "--format", "json", "--out", "x.txt"])));
        assert!(!ok("build", &args(&["a.mkp.md", "-o", "a.ir.json"])));
        assert!(!ok("fmt", &args(&["a.mkp", "--write"])));
    }
}
