"""Tech spec §9 — decide whether two expressions are equivalent.

Holds no state and no user data. The parser is restricted: a character
whitelist, a length and depth cap, no dunders, a fixed namespace, and
`evaluate=False` so that parsing itself does no algebra.
"""

from __future__ import annotations

import math
import multiprocessing as mp
import random
import re
from dataclasses import dataclass

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication,
    parse_expr,
    standard_transformations,
)

GRADER_VERSION = "1.0.0"
MAX_LENGTH = 512
MAX_DEPTH = 32
SIMPLIFY_BUDGET_S = 1.5
PROBE_TOLERANCE = 1e-9

_ALLOWED_CHARS = re.compile(r"^[A-Za-z0-9_+\-*/^().,\s]*$")
_TRANSFORMS = standard_transformations + (implicit_multiplication, convert_xor)

# The only names the transformed code may reference besides the namespace.
_GLOBALS = {
    "__builtins__": {},
    "Integer": sp.Integer,
    "Float": sp.Float,
    "Rational": sp.Rational,
    "Symbol": sp.Symbol,
    "Add": sp.Add,
    "Mul": sp.Mul,
    "Pow": sp.Pow,
}

FUNCTIONS = {
    "sqrt": sp.sqrt,
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "abs": sp.Abs,
    "floor": sp.floor,
    "ceil": sp.ceiling,
    "factorial": sp.factorial,
    "choose": sp.binomial,
    "binomial": sp.binomial,
    "harmonic": sp.harmonic,
    "min": sp.Min,
    "max": sp.Max,
    "sin": sp.sin,
    "cos": sp.cos,
}
CONSTANTS = {"pi": sp.pi, "e": sp.E, "E": sp.E}
# C(n, k) is the notation most learners type; it is a function unless C is a declared variable.
ALIASES = {"C": sp.binomial}


class GradeError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Verdict:
    correct: bool
    method: str
    normalised: str


def _assumption_kwargs(text: str | None) -> dict:
    t = (text or "").lower()
    kw: dict = {}
    if "integer" in t:
        kw["integer"] = True
    if "nonnegative" in t or "non-negative" in t:
        kw["nonnegative"] = True
    elif "positive" in t:
        kw["positive"] = True
    if "real" in t or "probability" in t or "(0,1)" in t or "0<" in t.replace(" ", ""):
        kw["real"] = True
    if "probability" in t or "(0,1)" in t or "0<" in t.replace(" ", ""):
        kw["positive"] = True
    if not kw:
        kw["real"] = True
    return kw


def build_symbols(variables: list[str], assumptions: dict[str, str]) -> dict[str, sp.Symbol]:
    out = {}
    for v in variables:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", v) or "__" in v:
            raise GradeError("BAD_REQUEST", f"invalid variable name {v!r}")
        out[v] = sp.Symbol(v, **_assumption_kwargs(assumptions.get(v)))
    return out


def _depth(s: str) -> int:
    d = best = 0
    for ch in s:
        if ch == "(":
            d += 1
            best = max(best, d)
        elif ch == ")":
            d -= 1
    return best


def split_implicit(src: str, symbols: dict[str, sp.Symbol]) -> str:
    """kN → k*N, but only when kN is not itself a name and every letter is a declared
    single-letter variable. Multi-letter variables such as sigma are never split."""
    def repl(m: re.Match) -> str:
        ident = m.group(0)
        if ident in symbols or ident in FUNCTIONS or ident in CONSTANTS:
            return ident
        if len(ident) > 1 and all(ch in symbols for ch in ident):
            return "*".join(ident)
        return ident
    return re.sub(r"[A-Za-z_][A-Za-z0-9_]*", repl, src)


def parse(src: str, symbols: dict[str, sp.Symbol]) -> sp.Expr:
    if len(src) > MAX_LENGTH:
        raise GradeError("PARSE_ERROR", "expression too long")
    if "__" in src:
        raise GradeError("PARSE_ERROR", "invalid expression")
    if not _ALLOWED_CHARS.match(src):
        raise GradeError("PARSE_ERROR", "unexpected character")
    if not src.strip():
        raise GradeError("PARSE_ERROR", "empty expression")
    if _depth(src) > MAX_DEPTH:
        raise GradeError("PARSE_ERROR", "expression too deeply nested")
    src = split_implicit(src, symbols)
    functions = {**FUNCTIONS, **{k: v for k, v in ALIASES.items() if k not in symbols}}
    for ident in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", src):
        if ident not in symbols and ident not in functions and ident not in CONSTANTS:
            raise GradeError("PARSE_ERROR", f'"{ident}" is not one of the allowed variables')
    namespace = {**functions, **CONSTANTS, **symbols}
    try:
        expr = parse_expr(
            src,
            local_dict=namespace,
            global_dict=_GLOBALS,
            transformations=_TRANSFORMS,
            evaluate=False,
        )
    except Exception as exc:  # noqa: BLE001 — any parser failure is a validation error
        raise GradeError("PARSE_ERROR", "not a valid expression") from exc
    if not isinstance(expr, sp.Basic):
        raise GradeError("PARSE_ERROR", "not a valid expression")
    return expr


def _simplify_worker(conn, submitted_src, answer_src, variables, assumptions):
    try:
        symbols = build_symbols(variables, assumptions)
        diff = sp.simplify(parse(submitted_src, symbols) - parse(answer_src, symbols))
        conn.send(("ok", bool(diff == 0)))
    except Exception as exc:  # noqa: BLE001
        conn.send(("err", str(exc)))
    finally:
        conn.close()


def _algebraic(submitted_src, answer_src, variables, assumptions, budget_s) -> bool | None:
    """True/False if simplify decides inside the budget; None on budget exhaustion."""
    ctx = mp.get_context("fork")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_simplify_worker, args=(child, submitted_src, answer_src, variables, assumptions))
    proc.start()
    child.close()
    try:
        if parent.poll(budget_s):
            status, value = parent.recv()
            return value if status == "ok" else None
        return None
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(0.1)
        parent.close()


def _sample(sym: sp.Symbol, rng: random.Random):
    a = sym.assumptions0
    if a.get("integer"):
        lo = 0 if a.get("nonnegative") else 1 if a.get("positive") else -8
        return sp.Integer(rng.randint(lo, 14))
    if a.get("positive") and a.get("real") and sym.name.lower().startswith("p"):
        return sp.Float(rng.uniform(0.05, 0.95))
    if a.get("positive") or a.get("nonnegative"):
        return sp.Float(rng.uniform(0.1, 5))
    return sp.Float(rng.uniform(-4, 4))


def numeric_probe(submitted: sp.Expr, answer: sp.Expr, symbols: dict[str, sp.Symbol], points: int, seed: int = 0) -> bool | None:
    """Evaluate both at `points` pseudo-random points in the declared domain.
    Returns None if too few points produce finite values to decide."""
    rng = random.Random(seed)
    agreed = 0
    for _ in range(points * 3):
        subs = {s: _sample(s, rng) for s in symbols.values()}
        try:
            a = complex(sp.N(submitted.subs(subs), 30))
            b = complex(sp.N(answer.subs(subs), 30))
        except Exception:  # noqa: BLE001
            continue
        if not all(math.isfinite(x) for x in (a.real, a.imag, b.real, b.imag)):
            continue
        scale = max(1.0, abs(a), abs(b))
        if abs(a - b) > PROBE_TOLERANCE * scale:
            return False
        agreed += 1
        if agreed >= points:
            return True
    return True if agreed >= max(3, points // 4) else None


def grade(submitted: str, answer: str, variables: list[str], assumptions: dict[str, str], probe_points: int = 20,
          equivalence: str = "algebraic", budget_s: float = SIMPLIFY_BUDGET_S) -> Verdict:
    symbols = build_symbols(variables, assumptions)
    sub_expr = parse(submitted, symbols)  # raises PARSE_ERROR → 422, not a wrong answer
    ans_expr = parse(answer, symbols)
    normalised = str(sub_expr)

    # Cheap exact check first: structural expansion settles most closed forms instantly.
    try:
        if sp.expand(sub_expr - ans_expr) == 0:
            return Verdict(True, "algebraic", normalised)
    except Exception:  # noqa: BLE001
        pass

    if equivalence == "algebraic":
        decided = _algebraic(submitted, answer, variables, assumptions, budget_s)
        if decided is True:
            return Verdict(True, "algebraic", normalised)
        # simplify returning a non-zero residue is not proof of inequivalence; let the probe decide.

    probed = numeric_probe(sub_expr, ans_expr, symbols, probe_points)
    if probed is None:
        raise GradeError("UNDECIDABLE", "could not evaluate the expressions in the declared domain")
    return Verdict(probed, "numeric_probe", normalised)
