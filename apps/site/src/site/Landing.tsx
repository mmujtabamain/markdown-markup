// The site's landing page (/): what MKP is, one document drawn live beside its source and its
// Markdown, how it works, and how to get it. The playground is the docs, at docs/.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Blocks, BookOpen, Check, Copy, Download, FileText, Github, Moon, ScanSearch, Sparkles, Sun, Terminal, Bot, Layers } from 'lucide-react';
import { compile, MathsEngine, prerender, Runtime, writeMarkdown, Diagnostics, type IRBundle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { markdownToHtml } from '@mkp/page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { components } from '../kit';

// the demo is example 25, as it is on disk
const demoSource = Object.values(import.meta.glob('../../../../examples/25-roots-of-unity/doc.mkp.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

const REPO = 'https://github.com/mmujtabamain/markdown-markup';
/** The release named on the page until /v/index.json says which is the newest. */
const FALLBACK_VERSION = '0.1.0';

type Theme = 'light' | 'dark';
const initialTheme = (): Theme => {
  try {
    const t = localStorage.getItem('site/theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // storage may be off
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('site/theme', theme);
      localStorage.setItem('pg/theme', theme);
    } catch {
      // storage may be off
    }
  }, [theme]);
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}

/** The newest release, from the site's own /v/index.json. */
function useLatest(): string {
  const [v, setV] = useState(FALLBACK_VERSION);
  useEffect(() => {
    fetch('v/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { latest?: string | null } | null) => j?.latest && setV(j.latest))
      .catch(() => undefined);
  }, []);
  return v;
}

/** The demo: example 25, compiled here, drawn, and written to Markdown. */
function useDemo(): { bundle: IRBundle | null; runtime: Runtime | null; md: string } {
  const [maths, setMaths] = useState<MathsEngine | null>(null);
  useEffect(() => {
    MathsEngine.create().then(setMaths, () => undefined);
  }, []);
  return useMemo(() => {
    if (!maths) return { bundle: null, runtime: null, md: '' };
    const c = compile({ packs: [] });
    const bundle = c.document(demoSource, 'roots.mkp.md');
    if (!bundle) return { bundle: null, runtime: null, md: '' };
    prerender(bundle, maths, new Diagnostics());
    const md = markdownToHtml(writeMarkdown(bundle, { toggles: ['gfm', 'math'], maths }).md.replace(/^<!--[\s\S]*?-->\s*/, ''), { maths });
    return { bundle, runtime: new Runtime(bundle, { capabilities: ['core@1', 'gfx@1'], maths }), md };
  }, [maths]);
}

function Copyable({ text, className }: { text: string; className?: string }): ReactNode {
  const [done, setDone] = useState(false);
  return (
    <div className={cn('group relative min-w-0 rounded-lg border bg-muted/50 font-mono text-[13px] leading-relaxed', className)}>
      <pre className="overflow-x-auto p-4 pr-12 whitespace-pre">{text}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 text-muted-foreground"
        aria-label={done ? 'Copied' : 'Copy'}
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function Logo(): ReactNode {
  return (
    <a href="./" className="flex items-center gap-2 font-semibold" aria-label="MKP home">
      <span className="grid size-7 place-items-center rounded-md bg-brand font-mono text-[11px] font-bold text-primary-foreground shadow-sm" aria-hidden>
        M↓
      </span>
      <span className="tracking-tight">MKP</span>
      <span className="hidden text-sm font-normal text-muted-foreground sm:inline">Markdown Markup</span>
    </a>
  );
}

function Header({ theme, toggle }: { theme: Theme; toggle: () => void }): ReactNode {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Logo />
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Site">
          <Button variant="ghost" size="sm" asChild>
            <a href="docs/">Docs</a>
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <a href={`${REPO}/releases`}>Releases</a>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={REPO} aria-label="MKP on GitHub">
              <Github />
            </a>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </nav>
      </div>
    </header>
  );
}

function Demo({ theme }: { theme: Theme }): ReactNode {
  const demo = useDemo();
  const drawn = demo.bundle && demo.runtime ? <MkpDocument bundle={demo.bundle} runtime={demo.runtime} theme={theme} components={components} tokens={shadcnTokens} /> : <p className="p-6 text-sm text-muted-foreground">Drawing…</p>;
  return (
    <Tabs defaultValue="drawn" className="w-full" data-site-demo="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="drawn">Drawn</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="markdown">Markdown</TabsTrigger>
        </TabsList>
        <span className="font-mono text-xs text-muted-foreground">roots.mkp.md</span>
      </div>
      <Card className="site-demo-card overflow-hidden py-0">
        <TabsContent value="drawn" className="m-0 p-5" data-site-drawn="">
          {drawn}
        </TabsContent>
        <TabsContent value="source" className="m-0">
          <pre className="max-h-[440px] overflow-auto p-5 font-mono text-[12.5px] leading-relaxed whitespace-pre">{demoSource.replace(/^---[\s\S]*?---\n+/, '')}</pre>
        </TabsContent>
        <TabsContent value="markdown" className="m-0 p-5">
          <p className="mb-3 text-xs text-muted-foreground">What a reader without MKP gets: the same document, as plain Markdown.</p>
          <article className="pg-md p-0" dangerouslySetInnerHTML={{ __html: demo.md }} />
        </TabsContent>
      </Card>
    </Tabs>
  );
}

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <FileText />, title: 'Markdown first', text: 'A document is Markdown. Headings, tables, maths and code come out as themselves; a widget is a fenced block with YAML inputs.' },
  { icon: <Blocks />, title: 'Compose, don’t wait', text: 'A small base set (layout, text, controls, a canvas) and everything else built from it, inline in the document or in a pack.' },
  { icon: <ScanSearch />, title: 'Checked like code', text: 'Static types and a compiler that names the line, the column and the fix. Mistakes surface before anyone reads the page.' },
  { icon: <Layers />, title: 'One IR, any renderer', text: 'Compile once to a JSON IR. Draw it with React, React Native, your own design system, or a page from one command.' },
  { icon: <BookOpen />, title: 'Readable everywhere', text: 'Every widget writes its own Markdown, so a document still reads well in a terminal, a diff or a search index.' },
  { icon: <Bot />, title: 'Made for agents', text: 'A one-line-per-widget catalog, copyable sources and precise errors: what an agent needs to write interactive pages that work.' },
];

const STEPS: { title: string; text: string; code: string }[] = [
  {
    title: 'Write',
    text: 'Markdown, with a widget where the reader should do more than read.',
    code: '```mkp\ncounter "A number to step."\n  var n int = 0\n  row gap=m\n    press label="one more"\n      text "+"\n      @click set n=(n + 1)\n    text "\\val{n}"\n  project md = "Count: " + format(n, 0)\n```',
  },
  { title: 'Check', text: 'Every error comes with its place and its fix.', code: '$ node mkp-cli.mjs check lesson.mkp.md\nlesson.mkp.md:4:5 error mkp.unknown-prop:\n  press has no prop "lable"; did you mean "label"?' },
  { title: 'Draw', text: 'In your app, as a page, or as plain Markdown.', code: "import { compile, Runtime } from './vendor/mkp/mkp.js';\nimport { MkpDocument } from './vendor/mkp/mkp-react.js';\n\n$ node mkp-cli.mjs build lesson.mkp.md --target html" },
];

export function Landing(): ReactNode {
  const [theme, toggle] = useTheme();
  const v = useLatest();
  const base = `${REPO}/releases/download/v${v}`;
  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header theme={theme} toggle={toggle} />
      <main>
        <section className="site-hero relative overflow-hidden border-b">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
            <div className="flex flex-col items-start gap-6">
              <a href={`${REPO}/releases/tag/v${v}`}>
                <Badge variant="outline" className="gap-1.5 rounded-full border-brand/30 bg-brand-soft px-3 py-1 text-xs text-accent-foreground" data-site-version="">
                  <Sparkles className="size-3.5 text-brand-warm" /> v{v} is out
                </Badge>
              </a>
              <h1 className="text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Markdown that <span className="site-mark">does things</span>.
              </h1>
              <p className="max-w-xl text-lg text-pretty text-muted-foreground">
                MKP is Markdown with widgets: sliders, steppers, canvases and checks, composed from a small base set, type-checked like code, and drawn by any renderer. Readers without it still get clean Markdown.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" asChild>
                  <a href="docs/">
                    Open the docs <ArrowRight />
                  </a>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#get">
                    <Download /> Get v{v}
                  </a>
                </Button>
              </div>
            </div>
            <Demo theme={theme} />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20" aria-labelledby="why">
          <h2 id="why" className="text-sm font-semibold tracking-wider text-brand uppercase">
            Why MKP
          </h2>
          <p className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">A format for documents that teach, explain and ask, written by people or by agents.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title} className="gap-3 transition-colors hover:border-brand/40">
                <CardHeader>
                  <span className="mb-1 grid size-9 place-items-center rounded-lg bg-brand-soft text-brand [&_svg]:size-4.5" aria-hidden>
                    {f.icon}
                  </span>
                  <CardTitle>{f.title}</CardTitle>
                  <CardDescription className="leading-relaxed">{f.text}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y bg-muted/30" aria-labelledby="how">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <h2 id="how" className="text-sm font-semibold tracking-wider text-brand uppercase">
              How it works
            </h2>
            <ol className="mt-8 grid gap-6 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full border border-brand/40 font-mono text-sm text-brand">{i + 1}</span>
                    <h3 className="text-lg font-semibold">{s.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{s.text}</p>
                  <pre className="rounded-lg border bg-background p-4 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">{s.code}</pre>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="get" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:py-20" aria-labelledby="get-title">
          <h2 id="get-title" className="text-sm font-semibold tracking-wider text-brand uppercase">
            Get it
          </h2>
          <p className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">Two files, no package manager.</p>
          <p className="mt-2 max-w-2xl text-muted-foreground">Every release is built from source on a merge to main. Download what you need, or import the web files from this site.</p>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Blocks className="size-4 text-brand" /> For a web app
                </CardTitle>
                <CardDescription>
                  <code className="font-mono">mkp-web-{v}.zip</code>: the core with its types header, the maths engine and the React renderer. They import each other: keep them in one folder.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Copyable text={`curl -LO ${base}/mkp-web-${v}.zip\nmkdir -p vendor/mkp && unzip -j mkp-web-${v}.zip -d vendor/mkp`} />
                <Copyable text={`import { compile, Runtime } from './vendor/mkp/mkp.js';\nimport { MkpDocument } from './vendor/mkp/mkp-react.js';`} />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="size-4 text-brand" /> For the command line
                </CardTitle>
                <CardDescription>
                  <code className="font-mono">mkp-cli.mjs</code>: the whole CLI in one file, for Node 20.19 or later. Check, build to IR or Markdown, or write a page.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Copyable text={`curl -LO ${base}/mkp-cli.mjs\nnode mkp-cli.mjs check lesson.mkp.md\nnode mkp-cli.mjs build lesson.mkp.md --target html --out out`} />
                <p className="text-sm text-muted-foreground">
                  Checksums are in <a className="text-brand underline-offset-2 hover:underline" href={`${base}/SHA256SUMS`}>SHA256SUMS</a>. All releases are on{' '}
                  <a className="text-brand underline-offset-2 hover:underline" href={`${REPO}/releases`}>
                    GitHub
                  </a>
                  .
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <Logo />
          <div className="flex flex-wrap gap-4">
            <a href="docs/" className="hover:text-foreground">
              Docs
            </a>
            <a href={`${REPO}/releases`} className="hover:text-foreground">
              Releases
            </a>
            <a href={REPO} className="hover:text-foreground">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
