//! Where in the spec each diagnostic's rule is written (targets/checks/rules.json), so an editor can
//! link a code to its rule.

use std::collections::HashMap;
use std::sync::OnceLock;

const RULES: &str = include_str!("../../../targets/checks/rules.json");

/// The spec's page and line for a diagnostic code: the first rule that names it.
pub fn place(code: &str) -> Option<&'static (String, u64)> {
    static BY_CODE: OnceLock<HashMap<String, (String, u64)>> = OnceLock::new();
    BY_CODE
        .get_or_init(|| {
            let mut m = HashMap::new();
            let all: serde_json::Value = serde_json::from_str(RULES).unwrap_or_default();
            for r in all["rules"].as_array().into_iter().flatten() {
                let (Some(page), Some(line)) = (r["page"].as_str(), r["line"].as_u64()) else { continue };
                for c in r["codes"].as_array().into_iter().flatten().filter_map(|c| c.as_str()) {
                    m.entry(c.to_string()).or_insert((page.to_string(), line));
                }
            }
            m
        })
        .get(code)
}

/// The spec's page for a code, on the repository this build is from.
pub fn link(code: &str) -> Option<String> {
    let (page, line) = place(code)?;
    Some(format!("{}/blob/main/docs/specs/{}#L{}", env!("CARGO_PKG_REPOSITORY"), page, line))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_code_links_to_its_rule() {
        let l = super::link("contracts.needs-proof").expect("a rule for contracts.needs-proof");
        assert!(l.contains("/docs/specs/02-values-and-types.md#L"), "{}", l);
        assert!(super::link("no.such-code").is_none());
    }
}
