//! The flags each command takes. One a command doesn't know is a warning, and it is ignored; one a
//! release of mkp dropped fails, saying what replaced it.

/// Each command's flags; one that takes a value takes it as the next argument or after `=`.
fn known(cmd: &str) -> &'static [&'static str] {
    const PACKS: [&str; 3] = ["--pack", "--config", "-c"];
    match cmd {
        "fmt" => &["--check"],
        "parse" => &[],
        "check" => &["--json", PACKS[0], PACKS[1], PACKS[2]],
        "build" => &["--rir", "-o", PACKS[0], PACKS[1], PACKS[2]],
        "md" => &["--json", "-o", PACKS[0], PACKS[1], PACKS[2]],
        "surface" => &["--check", "--force", "-o", PACKS[0], PACKS[1], PACKS[2]],
        "migrate" => &[
            "--pack", "--config", "-c", "--from", "--answers", "--format", "--report", "--dry-run", "--check", "--diff", "--yes", "-y", "--allow-dirty", "--allow-errors", "--allow-todos", "--help", "-h",
        ],
        "target check" => &["--cases", "--defect", "--expect-failures", "--require"],
        _ => &[],
    }
}

/// A flag a release dropped: its command, the flag, the release that dropped it, and what does its
/// work now ("nothing: …" where nothing does, and why). A later release that drops one adds it
/// here. A release of `""` is a flag mkp never had but is asked for, and why it has none.
const DROPPED: &[(&str, &str, &str, &str)] = &[
    ("build", "--target", "0.3.0", "mkp build writes the IR and mkp md the Markdown; drawing HTML is a target's"),
    ("build", "--out", "0.3.0", "use -o, with the file to write"),
    ("build", "--md", "0.3.0", "mkp md writes CommonMark with GitHub's tables, and has no switches"),
    ("build", "--lock", "0.3.0", "the version of each pack is mkp.toml's [uses]"),
    ("build", "--relock", "0.3.0", "the version of each pack is mkp.toml's [uses], which mkp migrate moves"),
    ("build", "--no-lock", "0.3.0", "there is no lock: the version of each pack is mkp.toml's [uses]"),
    ("build", "--diagnostics", "0.3.0", "use mkp check --json"),
    ("build", "--styles", "0.3.0", "the look is a target's to draw, and mkp writes no HTML"),
    ("build", "--profile", "0.3.0", "nothing: a pack has one surface per version"),
    ("build", "--name", "0.3.0", "nothing: mkp build reads a file, named by its path"),
    ("build", "--compact", "0.3.0", "nothing: the IR is written one way"),
    ("build", "--no-maths", "0.3.0", "nothing: maths is TeX passed to the target, which draws it"),
    ("build", "--no-speech", "0.3.0", "nothing: maths is TeX passed to the target, which draws it"),
    ("build", "--no-answers", "0.3.0", "nothing: mkp md writes a page with its starting values"),
    ("check", "--format", "0.3.0", "use --json"),
    ("check", "--diagnostics", "0.3.0", "use --json"),
    ("fmt", "--write", "0.3.0", "mkp fmt writes each file in place; --check only checks"),
    ("migrate", "--write", "0.3.0", "mkp migrate writes in place, asking first in a terminal; elsewhere --yes writes"),
    ("migrate", "--keep", "0.3.0", "a pack's migration asks with confirm, and --yes 1,3 answers its numbered questions (or --answers)"),
    ("migrate", "--take", "0.3.0", "a pack's migration asks with confirm, and --yes answers every question (or --answers)"),
    ("migrate", "--core", "0.3.0", "MKP_MIGRATE_02 names the frozen 0.2 step"),
    ("migrate", "--to", "", "a migration goes one way, to this mkp's release and to the version of each pack in the build"),
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
        assert!(ok("migrate", &args(&["docs", "--yes=1,3", "--pack=kit", "--stdout"])));
        assert!(!ok("migrate", &args(&["docs", "--write"])));
        assert!(!ok("migrate", &args(&["docs", "--to", "0.3.0"])));
        assert!(ok("fmt", &args(&["a.mkp", "--check", "-"])));
        assert!(!ok("fmt", &args(&["a.mkp", "--write"])));
    }
}
