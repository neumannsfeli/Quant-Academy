/**
 * Tech spec §19.5 — maths is LaTeX, rendered by KaTeX server-side at render time,
 * with throwOnError false and an error colour used as a sentinel so the CI content
 * sweep can fail the build on a malformed formula.
 */
import katex from "katex";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export const KATEX_ERROR_SENTINEL = "#cc0001";
const cache = new Map<string, string>();

function renderMath(src: string, display: boolean): string {
  return katex.renderToString(src, {
    displayMode: display,
    throwOnError: false,
    errorColor: KATEX_ERROR_SENTINEL,
    strict: "ignore",
    trust: false,
    output: "html",
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Split text on $…$ and $$…$$ (honouring \$), escape the prose, render the maths. */
export function renderTex(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let out = "";
  let i = 0;
  let buf = "";
  while (i < text.length) {
    if (text[i] === "\\" && text[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (text[i] === "$") {
      const display = text[i + 1] === "$";
      const open = display ? 2 : 1;
      const close = findClose(text, i + open, display);
      if (close < 0) {
        buf += text[i];
        i++;
        continue;
      }
      out += escapeHtml(buf);
      buf = "";
      out += renderMath(text.slice(i + open, close), display);
      i = close + open;
      continue;
    }
    buf += text[i];
    i++;
  }
  out += escapeHtml(buf);
  if (cache.size > 20_000) cache.clear();
  cache.set(text, out);
  return out;
}

function findClose(text: string, from: number, display: boolean): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === "$") {
      if (!display) return j;
      if (text[j + 1] === "$") return j;
    }
  }
  return -1;
}

/** Inline markdown (bold, italics, code) with maths, for short authored strings. */
export function renderInline(text: string): string {
  return renderTex(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "details", "summary", "span", "img", "svg", "path", "line",
    // KaTeX's MathML branch (screen readers read this, not the HTML).
    "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms", "mtext", "mspace", "msup", "msub", "msubsup",
    "mfrac", "msqrt", "mroot", "mover", "munder", "munderover", "mtable", "mtr", "mtd", "mstyle", "mpadded", "menclose",
  ],
  allowedAttributes: {
    "*": ["class", "style", "aria-hidden", "xmlns", "width", "height", "viewBox", "d", "encoding", "preserveAspectRatio",
      "mathvariant", "stretchy", "fence", "separator", "lspace", "rspace", "accent", "accentunder", "display", "displaystyle",
      "scriptlevel", "columnalign", "rowspacing", "columnspacing", "linethickness", "minsize", "maxsize", "notation", "x1", "x2", "y1", "y2", "stroke-width"],
    a: ["href"],
  },
  // KaTeX positions every glyph with inline styles; without them fractions and binomials collapse.
  // Style attributes cannot run script, and the CSP already permits inline styles.
  parseStyleAttributes: false,
  allowedSchemes: ["https", "mailto"],
};

/** Long-form markdown with maths: lessons, primers, concept bodies. */
export function renderMarkdown(md: string): string {
  const key = `md:${md}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // Pull maths out before markdown sees it, so `_` and `*` inside formulas survive.
  const blocks: string[] = [];
  const stash = (html: string) => `\u0000${blocks.push(html) - 1}\u0000`;
  const protectedMd = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => stash(renderMath(m, true)))
    .replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_, m: string) => stash(renderMath(m, false)));
  const html = (marked.parse(protectedMd, { async: false, gfm: true }) as string).replace(/\u0000(\d+)\u0000/g, (_, n: string) => blocks[Number(n)]!);
  const clean = sanitizeHtml(html, SANITIZE);
  cache.set(key, clean);
  return clean;
}

export function hasTexError(html: string): boolean {
  return html.includes(KATEX_ERROR_SENTINEL);
}
