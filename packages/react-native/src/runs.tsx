// Inline runs (text, emphasis, code, links, images, footnote references and maths) as nested
// <Text>. Maths is the engine's SVG drawn with react-native-svg, spoken by its speech text.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Image, Linking, Text, View, type TextStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { VRun } from '@mkp/core';
import { useCtx } from './context';

/** The text colour inherited from an enclosing element (a selected press inverts it). */
export const InkCtx = createContext<string | undefined>(undefined);

export function useInk(): string | undefined {
  const { theme } = useCtx();
  return useContext(InkCtx) ?? theme.color('ink');
}

/** MathJax's ex is a little under half the font size. */
export const EX_PER_EM = 0.44;

const exAttr = (svg: string, name: 'width' | 'height'): number | undefined => {
  const m = new RegExp(`^<svg[^>]*?\\s${name}="([\\d.]+)ex"`).exec(svg);
  return m ? Number(m[1]) : undefined;
};

export interface MathLike {
  tex: string;
  svg?: string;
  speech?: string;
  w?: number;
  h?: number;
  va?: number;
}

/** A formula: its SVG at the surrounding font size, or the TeX source while no SVG exists. */
export function MathView({ m, fontSize, display }: { m: MathLike; fontSize: number; display?: boolean }): ReactNode {
  const ink = useInk();
  const label = m.speech || m.tex;
  if (!m.svg) {
    return (
      <Text style={{ fontStyle: 'italic', color: ink }} accessibilityLabel={label}>
        {m.tex}
      </Text>
    );
  }
  const ex = fontSize * EX_PER_EM;
  const w = (m.w ?? exAttr(m.svg, 'width') ?? m.tex.length) * ex;
  const h = (m.h ?? exAttr(m.svg, 'height') ?? 2.2) * ex;
  // the SVG comes from the maths engine (TeX → MathJax → SVG, links removed), not from content
  const svg = <SvgXml xml={m.svg} width={w} height={h} color={ink} />;
  if (display) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ alignSelf: 'center', width: w, height: h }}>
        {svg}
      </View>
    );
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: w, height: h, transform: [{ translateY: -(m.va ?? 0) * ex * 0.5 }] }}>
      {svg}
    </View>
  );
}

export function Runs({ runs, fontSize }: { runs: VRun[] | undefined; fontSize: number }): ReactNode {
  return (runs ?? []).map((r, i) => <Run key={i} r={r} fontSize={fontSize} />);
}

function open(href: string): void {
  Linking.openURL(href).catch(() => undefined);
}

function Run({ r, fontSize }: { r: VRun; fontSize: number }): ReactNode {
  const { theme } = useCtx();
  switch (r.t) {
    case 'text': {
      const lines = [r.s ? 'line-through' : '', r.href ? 'underline' : ''].filter(Boolean).join(' ');
      const st: TextStyle = {
        fontWeight: r.b ? '700' : undefined,
        fontStyle: r.i ? 'italic' : undefined,
        color: r.href ? theme.color('accent') : undefined,
        textDecorationLine: lines ? (lines as TextStyle['textDecorationLine']) : undefined,
      };
      const href = r.href;
      return href ? (
        <Text style={st} accessibilityRole="link" onPress={() => open(href)}>
          {r.v}
        </Text>
      ) : (
        <Text style={st}>{r.v}</Text>
      );
    }
    case 'code': {
      const mono = theme.font('mono');
      const href = r.href;
      return (
        <Text
          style={{ fontFamily: mono.fontFamily, fontSize: fontSize * 0.9, backgroundColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.14), color: href ? theme.color('accent') : undefined }}
          accessibilityRole={href ? 'link' : undefined}
          onPress={href ? () => open(href) : undefined}
        >
          {r.v}
        </Text>
      );
    }
    case 'math':
      return <MathView m={r} fontSize={fontSize} />;
    case 'br':
      return '\n';
    case 'img':
      return <InlineImage src={r.src} alt={r.alt} />;
    case 'fnref':
      return (
        <Text style={{ fontSize: fontSize * 0.7, color: theme.color('accent') }} accessibilityLabel={`footnote ${r.label}`}>
          {`[${r.label}]`}
        </Text>
      );
  }
}

/** An SVG a bundle carries (a data URI): its text, for react-native-svg (React Native's Image draws raster only). */
export function svgData(src: string): string | null {
  const m = /^data:image\/svg\+xml(;charset=[^,;]*)?(;base64)?,/.exec(src);
  if (!m) return null;
  const body = src.slice(m[0].length);
  return m[2] ? (globalThis.atob ? globalThis.atob(body) : null) : decodeURIComponent(body);
}

/** An SVG's own size, from its viewBox (or width and height). */
export function svgSize(xml: string): { w: number; h: number } | null {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(xml);
  if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
  const w = /\swidth\s*=\s*["']([\d.]+)/.exec(xml);
  const h = /\sheight\s*=\s*["']([\d.]+)/.exec(xml);
  return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
}

/** An image in running text, sized from the file (capped), or a placeholder box until known. */
export function InlineImage({ src, alt, max = 320 }: { src: string; alt: string; max?: number }): ReactNode {
  const xml = svgData(src);
  if (xml) return <SvgImageOf xml={xml} alt={alt} max={max} />;
  return <RasterImage src={src} alt={alt} max={max} />;
}

/** A carried SVG drawn by react-native-svg, at its own shape, capped. */
function SvgImageOf({ xml, alt, max }: { xml: string; alt: string; max: number }): ReactNode {
  const own = svgSize(xml) ?? { w: max, h: max / 2 };
  const w = Math.min(max, own.w);
  return <SvgXml xml={xml} width={w} height={(w * own.h) / own.w} accessibilityLabel={alt} accessible={!!alt} />;
}

function RasterImage({ src, alt, max }: { src: string; alt: string; max: number }): ReactNode {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(Image.getSize(src))
      .then((s) => {
        if (live && s && s.width > 0) setSize({ w: s.width, h: s.height });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [src]);
  const w = size ? Math.min(max, size.w) : 24;
  const h = size ? (w * size.h) / size.w : 24;
  return <Image source={{ uri: src }} accessibilityLabel={alt} accessible={!!alt} style={{ width: w, height: h }} resizeMode="contain" />;
}
