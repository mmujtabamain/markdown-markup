//! The flags each command takes. One a command doesn't know is a warning, and it is ignored, but a
//! run that would write files writes nothing then; one a release of xtmd dropped fails, saying what
//! replaced it.

/// Each command's flags; one that takes a value takes it as the next argument or after `=`.
fn known(cmd: &str) -> &'static [&'static str] {
    // every command takes --format, --out and --help (page 1 of `xtmd`'s usage); one spelling each
    match cmd {
        "fmt" => &["--check", "--diff", "--stdout", "--stdin", "--format", "--out", "--help"],
        "parse" => &["--format", "--out", "--help"],
        "check" => &["--pack", "--config", "--format", "--out", "--help"],
        "build" => &["--rir", "--core", "--pack", "--config", "--format", "--out", "--help"],
        "md" => &["--pack", "--config", "--format", "--out", "--help"],
        "surface" => &["--check", "--diff", "--stdout", "--force", "--pack", "--config", "--format", "--out", "--help"],
        "migrate" => &[
            "--pack", "--config", "--from", "--answers", "--format", "--out", "--report", "--dry-run", "--check", "--diff", "--stdout", "--yes", "--allow-dirty", "--allow-errors", "--allow-todos", "--help",
        ],
        "target check" => &["--cases", "--defect", "--expect-failures", "--require", "--format", "--out", "--help"],
        "lsp" => &["--help"],
        _ => &[],
    }
}

/// The flags that take a value, as the next argument or after `=`.
pub(crate) const VALUED: &[&str] = &["--format", "--out", "--pack", "--config", "--from", "--answers", "--report", "--cases", "--defect", "--require"];

/// Whether a run of the command, with these flags, writes files the person has: fmt and surface
/// unless they only look, and migrate unless it only looks or prints.
pub(crate) fn writes(cmd: &str, args: &[String]) -> bool {
    let has = |f: &str| args.iter().any(|a| a == f);
    match cmd {
        "fmt" => !(has("--check") || has("--diff") || has("--stdout") || has("--stdin")),
        "surface" => !(has("--check") || has("--diff") || has("--stdout")),
        "migrate" => !(has("--dry-run") || has("--check") || has("--diff") || has("--stdout")),
        _ => false,
    }
}

/// A flag a release dropped: its command (`*` for every command), the flag, the release that dropped
/// it, and what does its work now ("nothing: …" where nothing does, and why). A later release that
/// drops one adds it here. A release of `""` is a flag xtmd never had but is asked for, and why it has
/// none.
const DROPPED: &[(&str, &str, &str, &str)] = &[
    ("build", "--target", "0.3.0", "xtmd build writes the IR and xtmd md the Markdown; drawing HTML is a target's"),
    ("build", "--md", "0.3.0", "xtmd md writes CommonMark with GitHub's tables, and has no switches"),
    ("build", "--lock", "0.3.0", "the version of each pack is xtmd.toml's [uses]"),
    ("build", "--relock", "0.3.0", "the version of each pack is xtmd.toml's [uses], which xtmd migrate moves"),
    ("build", "--no-lock", "0.3.0", "there is no lock: the version of each pack is xtmd.toml's [uses]"),
    ("build", "--diagnostics", "0.3.0", "use --format json"),
    ("build", "--styles", "0.3.0", "the look is a target's to draw, and xtmd writes no HTML"),
    ("build", "--profile", "0.3.0", "nothing: a pack has one surface per version"),
    ("build", "--name", "0.3.0", "nothing: xtmd build reads a file, named by its path"),
    ("build", "--compact", "0.3.0", "nothing: the IR is written one way"),
    ("build", "--no-maths", "0.3.0", "nothing: maths is TeX passed to the target, which draws it"),
    ("build", "--no-speech", "0.3.0", "nothing: maths is TeX passed to the target, which draws it"),
    ("build", "--no-answers", "0.3.0", "nothing: xtmd md writes a page with its starting values"),
    ("check", "--diagnostics", "0.3.0", "use --format json"),
    ("fmt", "--write", "0.3.0", "xtmd fmt writes each file in place; --check only checks"),
    ("migrate", "--write", "0.3.0", "xtmd migrate writes in place, asking first in a terminal; elsewhere --yes writes"),
    ("migrate", "--keep", "0.3.0", "a pack's migration asks with confirm, and --yes 1,3 answers its numbered questions (or --answers)"),
    ("migrate", "--take", "0.3.0", "a pack's migration asks with confirm, and --yes all answers every question yes (or --answers)"),
    ("migrate", "--core", "0.3.0", "XTMD_MIGRATE_02 names the frozen 0.2 step"),
    ("migrate", "--to", "", "a migration goes one way, to this xtmd's release and to the version of each pack in the build"),
    // one spelling for each flag: the short ones xtmd 0.3's development had, and the --json it had
    ("*", "-o", "", "use --out"),
    ("*", "-c", "", "use --config"),
    ("*", "-h", "", "use --help"),
    ("*", "--json", "", "use --format json"),
    ("migrate", "-y", "", "use --yes"),
];

/// The command's flags looked over: each one it doesn't know, warned about, and whether it can run;
/// a flag a release dropped stops it, with what replaced it.
pub(crate) fn check(cmd: &str, args: &[String]) -> (Vec<String>, bool) {
    let known = known(cmd);
    let (mut unknown, mut ok) = (Vec::new(), true);
    for a in args.iter().filter(|a| is_flag(a)) {
        let name = a.split_once('=').map_or(a.as_str(), |(n, _)| n);
        if known.contains(&name) {
            continue;
        }
        match DROPPED.iter().find(|(c, f, _, _)| (*c == cmd || *c == "*") && *f == name) {
            Some((_, _, since, instead)) => {
                match (since.is_empty(), instead.strip_prefix("nothing: ")) {
                    (true, _) => eprintln!("error: xtmd {} has no {}: {}", cmd, name, instead),
                    (false, Some(why)) => eprintln!("error: xtmd {} dropped {} in xtmd {}, and nothing replaces it: {}", cmd, name, since, why),
                    (false, None) => eprintln!("error: xtmd {} dropped {} in xtmd {}: {}", cmd, name, since, instead),
                }
                ok = false;
            }
            None => unknown.push(name.to_string()),
        }
    }
    (unknown, ok)
}

/// The warning for a flag the command doesn't know, with the one meant, when one is close.
pub(crate) fn warning(cmd: &str, flag: &str) -> String {
    let near = known(cmd).iter().copied().filter(|k| distance(k, flag) <= 2).min_by_key(|k| distance(k, flag));
    format!("xtmd {} has no flag {}, so it is ignored{}", cmd, flag, near.map_or(String::new(), |k| format!(" (did you mean {}?)", k)))
}

/// An argument that is a flag: `-x` or `--x…`, not `-` or a negative number.
pub(crate) fn is_flag(a: &str) -> bool {
    a.len() > 1 && a.starts_with('-') && a.trim_start_matches('-').chars().next().map_or(false, |c| c.is_ascii_alphabetic())
}

/// How many letters apart two flags are.
fn distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let here = row[j];
            row[j] = (row[j] + 1).min(row[j - 1] + 1).min(prev + usize::from(a[i - 1] != b[j - 1]));
            prev = here;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_dropped_flag_is_one_its_command_no_longer_takes() {
        for (cmd, flag, since, instead) in DROPPED {
            assert!(!known(cmd).contains(flag), "xtmd {} still takes {}", cmd, flag);
            assert!((since.is_empty() || crate::migrate::release_of(since).is_some()) && !instead.is_empty());
        }
    }

    #[test]
    fn an_unknown_flag_is_ignored_and_a_dropped_one_stops_the_command() {
        let args = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(check("migrate", &args(&["docs", "--yes=1,3", "--pack=kit", "--stdout", "--quiet"])), (vec!["--quiet".to_string()], true));
        assert!(!check("migrate", &args(&["docs", "--write"])).1);
        assert!(!check("migrate", &args(&["docs", "--to", "0.3.0"])).1);
        assert_eq!(check("fmt", &args(&["a.xtpack", "--check", "-", "--format", "json", "--out", "x.txt"])), (vec![], true));
        assert!(!check("build", &args(&["a.xt.md", "-o", "a.ir.json"])).1);
        assert!(!check("check", &args(&["a.xt.md", "-o", "report.txt"])).1);
        assert!(!check("fmt", &args(&["a.xtpack", "--write"])).1);
    }

    #[test]
    fn a_near_miss_names_the_flag_meant() {
        assert_eq!(warning("fmt", "--chek"), "xtmd fmt has no flag --chek, so it is ignored (did you mean --check?)");
        assert_eq!(warning("fmt", "--quiet"), "xtmd fmt has no flag --quiet, so it is ignored");
    }
}
