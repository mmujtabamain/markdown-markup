//! Diagnostics: what the compiler tells an author, each with a stable code.
//!
//! Checks compare diagnostics by code and place, never by message, so a message can be
//! reworded without breaking a check. Every code the reader can report is listed in [`codes`].

use crate::span::{Lines, Place, Span};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnostic {
    pub code: &'static str,
    pub severity: Severity,
    pub span: Span,
    pub message: String,
    /// What to write instead, where the spec gives one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

impl Diagnostic {
    pub fn error(code: &'static str, span: Span, message: impl Into<String>) -> Diagnostic {
        Diagnostic { code, severity: Severity::Error, span, message: message.into(), fix: None }
    }

    pub fn warning(code: &'static str, span: Span, message: impl Into<String>) -> Diagnostic {
        Diagnostic { code, severity: Severity::Warning, span, message: message.into(), fix: None }
    }

    pub fn with_fix(mut self, fix: impl Into<String>) -> Diagnostic {
        self.fix = Some(fix.into());
        self
    }

    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }

    /// `file:line:column: error[code]: message`, as the command prints it.
    pub fn render(&self, file: &str, src: &str) -> String {
        let at = Lines::new(src).place(self.span.start);
        let kind = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        let mut out = format!("{}:{}:{}: {}[{}]: {}", file, at.line, at.column, kind, self.code, self.message);
        if let Some(fix) = &self.fix {
            out.push_str(&format!("\n  fix: {}", fix));
        }
        out
    }

    pub fn place(&self, src: &str) -> Place {
        Lines::new(src).place(self.span.start)
    }
}

/// Every code the reader reports. Each one is one rule of the spec's grammar or file structure.
pub mod codes {
    // tokens
    pub const UNEXPECTED_CHAR: &str = "syntax.unexpected-character";
    pub const MIXED_CASE: &str = "syntax.mixed-case-name";
    pub const NUMBER_INTO_NAME: &str = "syntax.number-into-name";
    pub const TEXT_LINE: &str = "syntax.text-runs-over-a-line";
    pub const UNKNOWN_ESCAPE: &str = "syntax.unknown-escape";
    pub const BAD_UNICODE: &str = "syntax.bad-unicode-escape";
    pub const HOLE_UNCLOSED: &str = "syntax.hole-not-closed";
    pub const HOLE_ONE_EXPR: &str = "syntax.hole-holds-one-expression";
    pub const DOLLAR: &str = "syntax.dollar-is-only-state";
    pub const ATTRIBUTE: &str = "syntax.no-attributes";
    pub const DOC_COMMENT: &str = "syntax.unknown-doc-comment";

    // the grammar
    pub const EXPECTED: &str = "syntax.expected";
    pub const KEYWORD_AS_NAME: &str = "syntax.keyword-as-name";
    pub const MISSING_SEMICOLON: &str = "syntax.missing-semicolon";
    pub const MISSING_TYPE: &str = "syntax.missing-type";
    pub const CHAINED_COMPARISON: &str = "syntax.chained-comparison";
    pub const BOUND: &str = "syntax.bound-not-an-atom";
    pub const NOT_A_PLACE: &str = "syntax.not-a-place";
    pub const CASES_BIND_SHARED: &str = "syntax.shared-case-binds";
    pub const NO_COUNTER_LOOP: &str = "syntax.no-counter-loop";
    pub const NO_BY: &str = "syntax.no-by";
    pub const RANGE_ON_TEXT: &str = "syntax.range-on-text";
    pub const SMALL_TYPE_PARAM: &str = "syntax.small-type-parameter";
    pub const NEGATED_RANGE: &str = "syntax.negated-range";
    pub const NEGATIVE_NAME_BOUND: &str = "syntax.negative-name-bound";
    pub const CASE_VALUE: &str = "syntax.case-value-is-plain";
    pub const OLD_PACK_LINE: &str = "syntax.old-pack-line";
    pub const NO_TESTS: &str = "syntax.no-tests-in-the-language";
    pub const TOKEN_SHAPE: &str = "syntax.token-shape";
    pub const INTERFACE_AS_TYPE: &str = "syntax.implements-is-not-a-type";
    pub const POSITIONAL_AFTER_NAMED: &str = "syntax.mixed-arguments";
    pub const SET_TWICE: &str = "syntax.set-twice";
    pub const HYPHEN_NAME: &str = "syntax.hyphen-in-name";
    pub const MUT_IN_FOR: &str = "syntax.mut-before-for";
    pub const ASSIGN_IN_VIEW: &str = "syntax.assignment-in-view";

    // files and documents
    pub const DRAWING_IN_FILE: &str = "file.drawing-in-definitions";
    pub const TOP_MUT: &str = "file.mut-at-top";
    pub const STATE_IN_PACK: &str = "file.state-in-pack";
    pub const STATE_TWICE: &str = "file.state-twice";
    pub const STATE_NOT_TOP: &str = "file.state-not-at-top";
    pub const STATE_FIELD_DEFAULT: &str = "file.state-field-starting-value";
    pub const STATE_FIELD_MUT: &str = "file.state-field-mut";
    pub const EXPOSE_IN_PACK: &str = "file.expose-in-pack";
    pub const EXPOSE_IN_WIDGET: &str = "file.expose-in-widget";
    pub const PACK_IN_DOCUMENT: &str = "file.pack-in-document";
    pub const PACKAGE_LINE: &str = "file.package-line";
    pub const WIDGET_ORDER: &str = "widget.body-order";
    pub const WIDGET_MARKDOWN: &str = "widget.markdown-required";
    pub const WIDGET_VIEW: &str = "widget.view-required";
    pub const DOC_PARAM: &str = "doc.param-names-nothing";

    // prose
    pub const FRONT_MATTER: &str = "prose.front-matter-not-closed";
    pub const SECOND_DIVIDER: &str = "prose.second-divider";
    pub const NOT_A_CALL: &str = "prose.line-is-not-a-call";
    pub const CALL_END: &str = "prose.call-line-end";
    pub const BLOCK_UNCLOSED: &str = "prose.block-not-closed";
    pub const STRAY_BRACE: &str = "prose.stray-closing-brace";
    pub const STRAY_ELSE: &str = "prose.else-without-if";
    pub const SLOT_OUTSIDE: &str = "prose.slot-outside-a-call";
    pub const IN_QUOTE_OR_ITEM: &str = "prose.call-in-quote-or-item";
    pub const MATHS_UNCLOSED: &str = "prose.maths-block-not-closed";
    pub const HOLE_LINE: &str = "prose.hole-runs-over-a-line";
    pub const BRACE_LINE: &str = "prose.brace-ends-its-line";
    pub const MATCH_CASE: &str = "prose.match-holds-cases";

    // layout
    pub const LAYOUT: &str = "layout.brace";
    pub const FMT_COMMENT: &str = "fmt.comment-cannot-be-kept";
}
