import { parse, type Rpn } from "@qa/items/expr";

const FUNCS = new Set(["sqrt", "log", "exp", "abs", "floor", "ceil", "min", "max", "factorial", "choose", "binomial", "harmonic", "ln", "mod"]);

type Node = { html: string; prec: number };
const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "u-": 3, "^": 4 };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * "reads as" (frame 16): the typed expression rendered back so the candidate can
 * see how it was parsed — k*(N - k) → k (N − k). Pure client-side; the grader decides.
 */
export function readsAs(src: string, variables: string[]): { ok: true; html: string } | { ok: false; message: string } {
  if (!src.trim()) return { ok: false, message: "" };
  let rpn: Rpn;
  try {
    // Implicit multiplication like 2n or k(N-k) is accepted by the grader; mirror it here.
    const normalised = src
      // kN → k*N when kN is not a name and each letter is a declared variable (mirrors the grader).
      .replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => (!variables.includes(id) && !FUNCS.has(id) && id.length > 1 && [...id].every((c) => variables.includes(c)) ? [...id].join("*") : id))
      .replace(/(\d)\s*([A-Za-z(])/g, "$1*$2")
      .replace(/([A-Za-z_][A-Za-z0-9_]*|\d|\))\s*\(/g, (m, a: string) => (FUNCS.has(a) ? `${a}(` : `${a}*(`))
      .replace(/\)\s*([A-Za-z_])/g, ")*$1")
      .replace(/\bln\(/g, "log(")
      .replace(/\bbinomial\(/g, "choose(");
    rpn = parse(normalised, { logic: false, maxLength: 512, maxDepth: 32 });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const unknown = rpn.filter((n) => n.k === "var" && !variables.includes(n.name)).map((n) => (n as { name: string }).name);
  if (unknown.length) return { ok: false, message: `"${unknown[0]}" is not in scope` };
  const st: Node[] = [];
  const wrap = (n: Node, p: number) => (n.prec < p ? `(${n.html})` : n.html);
  for (const n of rpn) {
    if (n.k === "num") st.push({ html: Number.isInteger(n.v) ? String(n.v) : n.v === Math.PI ? "π" : n.v === Math.E ? "e" : String(n.v), prec: 9 });
    else if (n.k === "var") st.push({ html: `<i>${esc(n.name)}</i>`, prec: 9 });
    else if (n.k === "fn") {
      const args = st.splice(st.length - n.argc, n.argc);
      const name = n.name === "choose" ? "C" : n.name;
      st.push({ html: `${name}(${args.map((a) => a.html).join(", ")})`, prec: 9 });
    } else if (n.arity === 1) {
      const a = st.pop()!;
      st.push({ html: n.op === "u-" ? `−${wrap(a, 3)}` : a.html, prec: 3 });
    } else {
      const b = st.pop()!;
      const a = st.pop()!;
      const p = PREC[n.op] ?? 1;
      if (n.op === "^") st.push({ html: `${wrap(a, 5)}<sup>${b.html}</sup>`, prec: 4 });
      else if (n.op === "*") {
        const implicit = /^<i>/.test(b.html) || b.html.startsWith("(") || /^[a-zA-Z]/.test(b.html);
        const right = wrap(b, p);
        const left = wrap(a, p);
        const sep = /\d$/.test(left) && right.startsWith("<i>") ? "" : implicit || right.startsWith("(") ? " " : " · ";
        st.push({ html: `${left}${sep}${right}`, prec: p });
      } else if (n.op === "/") st.push({ html: `${wrap(a, p)} / ${wrap(b, p + 1)}`, prec: p });
      else st.push({ html: `${wrap(a, p)} ${n.op === "-" ? "−" : "+"} ${wrap(b, n.op === "-" ? p + 1 : p)}`, prec: p });
    }
  }
  return { ok: true, html: st[0]?.html ?? "" };
}
