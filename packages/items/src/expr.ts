/**
 * Tech spec §7 — the expression language for constraints, answers and numeric
 * submissions. Shunting-yard to RPN, then evaluate. Not eval, not new Function,
 * not a maths library: this parser is the trust boundary for authored content.
 *
 * Grammar: numbers, identifiers, + - * / ^ ( ) , unary ±, comparisons
 * (< <= > >= == !=), boolean (&& || !), constants pi and e, and the functions
 * floor ceil abs min max sqrt log exp factorial choose mod.
 * There is deliberately no `sum`. tools/validate.py implements the same grammar.
 */

export class ExprError extends Error {
  constructor(message: string, readonly position?: number) {
    super(message);
    this.name = "ExprError";
  }
}

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "lp"; pos: number }
  | { t: "rp"; pos: number }
  | { t: "comma"; pos: number };

export type Rpn = (
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "op"; op: string; arity: 1 | 2 }
  | { k: "fn"; name: string; argc: number }
)[];

export const FUNCTIONS: Record<string, { min: number; max: number; fn: (...a: number[]) => number }> = {
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  abs: { min: 1, max: 1, fn: Math.abs },
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  log: { min: 1, max: 1, fn: Math.log },
  exp: { min: 1, max: 1, fn: Math.exp },
  min: { min: 1, max: 32, fn: Math.min },
  max: { min: 1, max: 32, fn: Math.max },
  factorial: { min: 1, max: 1, fn: factorial },
  choose: { min: 2, max: 2, fn: choose },
  mod: { min: 2, max: 2, fn: (a, b) => a - b * Math.floor(a / b) },
};

export const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function choose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k)) return NaN;
  if (k < 0 || n < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

const PREC: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "u-": 7,
  "u+": 7,
  "!": 7,
  "^": 8,
};
const RIGHT = new Set(["^", "u-", "u+", "!"]);
const OPS = ["<=", ">=", "==", "!=", "&&", "||", "**", "+", "-", "*", "/", "^", "<", ">", "!"];

export type ParseOptions = {
  /** allow identifiers other than the constants */
  variables?: boolean;
  /** allow comparison and boolean operators */
  logic?: boolean;
  maxLength?: number;
  maxDepth?: number;
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      if (id[0].includes("__")) throw new ExprError("invalid identifier", i);
      out.push({ t: "id", v: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    if (ch === "(") {
      out.push({ t: "lp", pos: i++ });
      continue;
    }
    if (ch === ")") {
      out.push({ t: "rp", pos: i++ });
      continue;
    }
    if (ch === ",") {
      out.push({ t: "comma", pos: i++ });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: "op", v: op === "**" ? "^" : op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExprError(`unexpected character "${ch}"`, i);
  }
  return out;
}

const cache = new Map<string, Rpn>();

export function parse(src: string, opts: ParseOptions = {}): Rpn {
  const { variables = true, logic = true, maxLength = 4096, maxDepth = 64 } = opts;
  const key = `${variables ? 1 : 0}${logic ? 1 : 0}${maxLength}:${maxDepth}:${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (src.length > maxLength) throw new ExprError("expression too long");
  if (!src.trim()) throw new ExprError("empty expression");

  const toks = tokenize(src);
  const out: Rpn = [];
  type StackItem = { kind: "op"; op: string } | { kind: "lp"; fn?: string; argc: number; sawArg: boolean };
  const stack: StackItem[] = [];
  let expectOperand = true;
  let depth = 0;

  const popOp = () => {
    const top = stack.pop();
    if (!top || top.kind !== "op") throw new ExprError("mismatched parentheses");
    const unary = top.op === "u-" || top.op === "u+" || top.op === "!";
    out.push({ k: "op", op: top.op, arity: unary ? 1 : 2 });
  };

  for (let idx = 0; idx < toks.length; idx++) {
    const tok = toks[idx]!;
    if (tok.t === "num") {
      if (!expectOperand) throw new ExprError("unexpected number", tok.pos);
      out.push({ k: "num", v: tok.v });
      markArg();
      expectOperand = false;
    } else if (tok.t === "id") {
      if (!expectOperand) throw new ExprError("unexpected identifier", tok.pos);
      const next = toks[idx + 1];
      if (next && next.t === "lp") {
        if (!FUNCTIONS[tok.v]) throw new ExprError(`unknown function "${tok.v}"`, tok.pos);
        markArg();
        stack.push({ kind: "lp", fn: tok.v, argc: 0, sawArg: false });
        depth++;
        if (depth > maxDepth) throw new ExprError("expression too deeply nested");
        idx++; // consume "("
        expectOperand = true;
        continue;
      }
      if (tok.v in CONSTANTS) out.push({ k: "num", v: CONSTANTS[tok.v]! });
      else if (!variables) throw new ExprError(`"${tok.v}" is not a number`, tok.pos);
      else if (FUNCTIONS[tok.v]) throw new ExprError(`function "${tok.v}" needs arguments`, tok.pos);
      else out.push({ k: "var", name: tok.v });
      markArg();
      expectOperand = false;
    } else if (tok.t === "op") {
      let op = tok.v;
      if (expectOperand) {
        if (op === "-") op = "u-";
        else if (op === "+") op = "u+";
        else if (op !== "!") throw new ExprError(`unexpected operator "${tok.v}"`, tok.pos);
      } else if (op === "!") {
        throw new ExprError('unexpected "!"', tok.pos);
      }
      if (!logic && !["+", "-", "*", "/", "^", "u-", "u+"].includes(op)) {
        throw new ExprError(`operator "${tok.v}" not allowed here`, tok.pos);
      }
      const p = PREC[op]!;
      // prefix operators bind to what follows; they never pop what came before
      const prefix = op === "u-" || op === "u+" || op === "!";
      while (!prefix && stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.kind !== "op") break;
        const tp = PREC[top.op]!;
        if (tp > p || (tp === p && !RIGHT.has(op))) popOp();
        else break;
      }
      stack.push({ kind: "op", op });
      expectOperand = true;
    } else if (tok.t === "lp") {
      if (!expectOperand) throw new ExprError('unexpected "("', tok.pos);
      markArg();
      stack.push({ kind: "lp", argc: 0, sawArg: false });
      depth++;
      if (depth > maxDepth) throw new ExprError("expression too deeply nested");
    } else if (tok.t === "comma") {
      if (expectOperand) throw new ExprError('unexpected ","', tok.pos);
      while (stack.length && stack[stack.length - 1]!.kind === "op") popOp();
      const top = stack[stack.length - 1];
      if (!top || top.kind !== "lp" || !top.fn) throw new ExprError('unexpected ","', tok.pos);
      top.argc++;
      top.sawArg = false;
      expectOperand = true;
    } else {
      if (expectOperand) {
        const top = stack[stack.length - 1];
        // allow f() only to report a clean arity error
        if (!(top && top.kind === "lp" && top.fn && top.argc === 0 && !top.sawArg)) {
          throw new ExprError('unexpected ")"', tok.pos);
        }
      }
      while (stack.length && stack[stack.length - 1]!.kind === "op") popOp();
      const top = stack.pop();
      if (!top || top.kind !== "lp") throw new ExprError("mismatched parentheses", tok.pos);
      depth--;
      if (top.fn) {
        const argc = top.sawArg ? top.argc + 1 : top.argc;
        const spec = FUNCTIONS[top.fn]!;
        if (argc < spec.min || argc > spec.max) {
          throw new ExprError(`${top.fn} takes ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} argument(s)`, tok.pos);
        }
        out.push({ k: "fn", name: top.fn, argc });
      }
      expectOperand = false;
    }
  }
  if (expectOperand) throw new ExprError("incomplete expression");
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    if (top.kind === "lp") throw new ExprError("mismatched parentheses");
    popOp();
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;

  function markArg() {
    const top = stack[stack.length - 1];
    if (top && top.kind === "lp") top.sawArg = true;
  }
}

export type Scope = Readonly<Record<string, number>>;

export function evaluateRpn(rpn: Rpn, scope: Scope = {}): number {
  const st: number[] = [];
  for (const node of rpn) {
    switch (node.k) {
      case "num":
        st.push(node.v);
        break;
      case "var": {
        const v = scope[node.name];
        if (v === undefined) throw new ExprError(`unknown variable "${node.name}"`);
        st.push(v);
        break;
      }
      case "fn": {
        const args = st.splice(st.length - node.argc, node.argc);
        st.push(FUNCTIONS[node.name]!.fn(...args));
        break;
      }
      case "op": {
        if (node.arity === 1) {
          const a = st.pop()!;
          st.push(node.op === "u-" ? -a : node.op === "u+" ? a : a ? 0 : 1);
          break;
        }
        const b = st.pop()!;
        const a = st.pop()!;
        st.push(binary(node.op, a, b));
        break;
      }
    }
  }
  if (st.length !== 1) throw new ExprError("malformed expression");
  return st[0]!;
}

function binary(op: string, a: number, b: number): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "^": return Math.pow(a, b);
    case "<": return a < b ? 1 : 0;
    case "<=": return a <= b ? 1 : 0;
    case ">": return a > b ? 1 : 0;
    case ">=": return a >= b ? 1 : 0;
    case "==": return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? 1 : 0;
    case "!=": return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? 0 : 1;
    case "&&": return a && b ? 1 : 0;
    case "||": return a || b ? 1 : 0;
  }
  throw new ExprError(`unknown operator ${op}`);
}

export function evaluate(src: string, scope: Scope = {}, opts?: ParseOptions): number {
  return evaluateRpn(parse(src, opts), scope);
}

/** Free identifiers referenced by an expression (excluding constants and functions). */
export function freeVariables(src: string): string[] {
  const names = new Set<string>();
  for (const n of parse(src)) if (n.k === "var") names.add(n.name);
  return [...names];
}

/**
 * Tech spec §7 — the reduced grammar for a user's numeric submission: no
 * variables, no comparisons, depth 32, length 256. Normalises separators,
 * currency, a trailing percent sign and mixed numbers ("2 3/4") first.
 */
export function parseSubmission(raw: string): { ok: true; value: number } | { ok: false; reason: string } {
  let s = raw.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (s.length > 256) return { ok: false, reason: "too long" };
  s = s.replace(/[$£€¥]/g, "").replace(/%$/, "").replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/");
  // thousands separators: a comma between a digit and exactly three digits
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  const mixed = /^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (mixed) s = `${mixed[1]}(${mixed[2]} + ${mixed[3]}/${mixed[4]})`;
  try {
    const value = evaluate(s, {}, { variables: false, logic: false, maxLength: 256, maxDepth: 32 });
    if (!Number.isFinite(value)) return { ok: false, reason: "not a finite number" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: e instanceof ExprError ? e.message : "not a number" };
  }
}
