/** Number formatting shared by stems, MCQ options and the answer screen. */

export type NumberFormat =
  | { kind: "auto" }
  | { kind: "fixed"; decimals: number }
  | { kind: "percent"; decimals: number }
  | { kind: "fraction" }
  | { kind: "int" }
  | { kind: "sig"; digits: number }
  | { kind: "money"; decimals: number };

export function parseFormat(spec: string | undefined): NumberFormat {
  if (!spec) return { kind: "auto" };
  const [name, arg] = spec.split(":").map((s) => s.trim());
  const n = arg !== undefined ? Number(arg) : undefined;
  switch (name) {
    case "fixed":
      return { kind: "fixed", decimals: n ?? 2 };
    case "percent":
      return { kind: "percent", decimals: n ?? 0 };
    case "fraction":
      return { kind: "fraction" };
    case "int":
      return { kind: "int" };
    case "sig":
      return { kind: "sig", digits: n ?? 3 };
    case "money":
      return { kind: "money", decimals: n ?? 2 };
    default:
      return { kind: "auto" };
  }
}

/** Best rational approximation with bounded denominator (continued fractions). */
export function toFraction(x: number, maxDen = 10000): { num: number; den: number } | null {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  let v = Math.abs(x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    if (Math.abs(Math.abs(x) - h1 / k1) < 1e-9 * Math.max(1, Math.abs(x))) {
      return { num: sign * h1, den: k1 };
    }
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  if (k1 > 0 && Math.abs(Math.abs(x) - h1 / k1) < 1e-9 * Math.max(1, Math.abs(x))) {
    return { num: sign * h1, den: k1 };
  }
  return null;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

function groupThousands(s: string): string {
  const [int, dec] = s.split(".");
  const neg = int!.startsWith("-");
  const digits = neg ? int!.slice(1) : int!;
  const grouped = digits.length > 4 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : digits;
  return `${neg ? "-" : ""}${grouped}${dec !== undefined ? `.${dec}` : ""}`;
}

export function formatNumber(x: number, fmt: NumberFormat = { kind: "auto" }): string {
  if (!Number.isFinite(x)) return String(x);
  switch (fmt.kind) {
    case "fixed":
      return groupThousands(x.toFixed(fmt.decimals));
    case "percent":
      return `${trimZeros((x * 100).toFixed(fmt.decimals))}%`;
    case "int":
      return groupThousands(Math.round(x).toString());
    case "money":
      return `${x < 0 ? "-" : ""}$${groupThousands(Math.abs(x).toFixed(fmt.decimals))}`;
    case "sig":
      return groupThousands(trimZeros(Number(x.toPrecision(fmt.digits)).toString()));
    case "fraction": {
      if (Number.isInteger(x)) return String(x);
      const f = toFraction(x);
      return f ? `${f.num}/${f.den}` : formatNumber(x);
    }
    case "auto": {
      if (Number.isInteger(x)) return groupThousands(String(x));
      const abs = Math.abs(x);
      if (abs >= 1e9 || abs < 1e-4) return x.toPrecision(4);
      const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : 5;
      return groupThousands(trimZeros(x.toFixed(decimals)));
    }
  }
}
