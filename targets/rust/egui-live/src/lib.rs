//! Extended Mark's real-time desktop target: [`XtmdLiveDoc`], a document's text compiled in the app as it is
//! edited and drawn by xtmd-egui's [`XtmdDoc`]. A text that compiles replaces the page, keeping
//! `$state` where its fields still exist. One that doesn't leaves the last page that did, and its
//! errors come back with the next frame ([`DocError::Compile`]) and from [`XtmdLiveDoc::diagnostics`].
//! When to give it a new text (each key, a pause, a save) is the app's.
//!
//! The compiler is xtmd-live's, with core compiled once for the app ([`compiler`]). The run-time
//! target, xtmd-egui, doesn't carry it.

use std::rc::Rc;

use egui::Ui;
use xtmd_egui::doc::{DocError, DocOptions, DocResponse, XtmdDoc, State};
pub use xtmd_live::{Compiler, Diagnostic, Followed, Source};
use xtmd_live::Live;

thread_local! {
    static COMPILER: Rc<Compiler> = Rc::new(Compiler::new());
}

/// The app's compiler: core is compiled the first time it is asked for (the slow part), once.
pub fn compiler() -> Rc<Compiler> {
    COMPILER.with(Rc::clone)
}

/// A document from its text, drawn by egui.
pub struct XtmdLiveDoc {
    compiler: Rc<Compiler>,
    live: Live,
    doc: Option<XtmdDoc>,
    /// How the first page that compiles starts; the pages after it keep its widgets.
    options: Option<DocOptions>,
    externs: Vec<(String, State)>,
    errors: Vec<DocError>,
}

impl XtmdLiveDoc {
    /// A document from `text`, at `page.xtmd`, compiled now with the app's compiler.
    pub fn new(text: &str, options: DocOptions) -> XtmdLiveDoc {
        XtmdLiveDoc::with(compiler(), "page.xtmd", Vec::new(), text, options)
    }

    /// A document at `path`, with the files of the packs it uses, compiled by `compiler`.
    pub fn with(compiler: Rc<Compiler>, path: &str, packs: Vec<Source>, text: &str, options: DocOptions) -> XtmdLiveDoc {
        let externs = options.externs.clone();
        let mut d = XtmdLiveDoc { compiler, live: Live::new(path).with_packs(packs), doc: None, options: Some(options), externs, errors: Vec::new() };
        d.set_text(text);
        d
    }

    /// The text, as it is now: built unless it is the last one built.
    pub fn set_text(&mut self, text: &str) -> Followed {
        let followed = self.live.follow(&self.compiler, text);
        match followed {
            Followed::Same => {}
            Followed::Broken => self.errors.push(DocError::Compile(self.live.why().unwrap_or_default())),
            Followed::Compiled => {
                let file = self.live.ir().cloned().expect("a text that compiled has its IR");
                let r = match (&mut self.doc, self.options.take()) {
                    (Some(doc), _) => doc.replace(file, self.externs.clone()),
                    (None, Some(options)) => XtmdDoc::new(file, options).map(|d| self.doc = Some(d)),
                    (None, None) => XtmdDoc::new(file, DocOptions { externs: self.externs.clone(), ..DocOptions::default() }).map(|d| self.doc = Some(d)),
                };
                if let Err(e) = r {
                    self.errors.push(e);
                }
            }
        }
        followed
    }

    /// The files of the packs the text uses; the next text is built with them.
    pub fn set_packs(&mut self, packs: Vec<Source>) {
        self.live.set_packs(packs);
    }

    /// The latest text's diagnostics, warnings included.
    pub fn diagnostics(&self) -> &[Diagnostic] {
        self.live.diagnostics()
    }

    /// The latest text's errors as one line: none when it compiled.
    pub fn why(&self) -> Option<String> {
        self.live.why()
    }

    /// The document drawn: the last text that compiled. None until one has.
    pub fn doc(&self) -> Option<&XtmdDoc> {
        self.doc.as_ref()
    }

    pub fn doc_mut(&mut self) -> Option<&mut XtmdDoc> {
        self.doc.as_mut()
    }

    /// Draws the last page that compiled; call it every frame. Before one has, the reason is
    /// shown. What the frame did comes back, a text that didn't compile among its errors.
    pub fn show(&mut self, ui: &mut Ui) -> DocResponse {
        let mut r = match &mut self.doc {
            Some(doc) => doc.show(ui),
            None => {
                let why = self.live.why().unwrap_or_else(|| "Compiling…".into());
                DocResponse { response: Some(ui.weak(why)), ..DocResponse::default() }
            }
        };
        r.errors.splice(0..0, std::mem::take(&mut self.errors));
        r
    }

    /// [`XtmdDoc::show_controlled`] on the last page that compiled.
    pub fn show_controlled(&mut self, ui: &mut Ui, state: &mut State) -> DocResponse {
        let mut r = match &mut self.doc {
            Some(doc) => doc.show_controlled(ui, state),
            None => return self.show(ui),
        };
        r.errors.splice(0..0, std::mem::take(&mut self.errors));
        r
    }
}

#[cfg(feature = "check")]
impl xtmd_egui::check::adapter::AsDoc for XtmdLiveDoc {
    fn doc(&mut self) -> &mut XtmdDoc {
        self.doc.as_mut().expect("a loaded case has compiled")
    }

    fn doc_ref(&self) -> &XtmdDoc {
        self.doc.as_ref().expect("a loaded case has compiled")
    }

    fn show(&mut self, ui: &mut Ui) -> DocResponse {
        XtmdLiveDoc::show(self, ui)
    }
}
