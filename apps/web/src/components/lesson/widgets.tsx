"use client";

/**
 * Tech spec §19.4 — lesson widgets. Each is seeded from its authored config so the
 * first run matches what the author saw; "Run again" advances the seed. Nothing
 * animates, so reduced motion needs no special case. Never scored.
 */
import { useMemo, useState, type ReactNode } from "react";
import { focusRing } from "../ui";

type Config = Record<string, unknown>;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (c: Config, k: string, d: number) => (typeof c[k] === "number" ? (c[k] as number) : d);

export function LessonWidget({ widget, config }: { widget: string; config: Config }) {
  switch (widget) {
    case "random_walk":
      return <RandomWalk config={config} />;
    case "bayes_grid":
      return <BayesGrid config={config} />;
    case "sampling_explorer":
      return <SamplingExplorer config={config} />;
    case "kelly_growth":
      return <KellyGrowth config={config} />;
    default:
      return <p className="text-[12px] text-ink-3">This widget is not available.</p>;
  }
}

function Frame({ title, controls, children, stats }: { title: string; controls: ReactNode; children: ReactNode; stats: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="bg-surface border border-line rounded-[10px] p-[18px] flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="label">{title}</span>
        <div className="flex items-center gap-2 flex-wrap">{controls}</div>
      </div>
      <div className="bg-inset rounded-[8px] overflow-hidden">{children}</div>
      <dl className="grid grid-cols-4 gap-3 bg-inset rounded-[8px] px-3 py-[10px]" aria-live="polite">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[10px] text-ink-3">{s.label}</dt>
            <dd className="font-mono text-[12.5px]" style={{ color: s.color ?? "var(--text-primary)" }}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Select({ label, value, options, onChange, fmt = String }: { label: string; value: number; options: number[]; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="flex items-center gap-2 bg-elevated border border-line-strong rounded-[6px] px-[10px] py-[5px] font-mono text-[10.5px] text-ink-2">
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={`bg-transparent text-ink outline-none ${focusRing}`}>
        {options.map((o) => (
          <option key={o} value={o} className="bg-elevated">
            {fmt(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="flex items-center gap-2 bg-elevated border border-line-strong rounded-[6px] px-[10px] py-[5px] font-mono text-[10.5px] text-ink-2">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-[90px] accent-[var(--accent-blue)]" />
      <span className="text-ink w-[44px] text-right">{fmt(value)}</span>
    </label>
  );
}

function Again({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={`bg-elevated border border-line-strong rounded-[6px] px-3 py-[5px] text-[12px] text-ink-2 hover:text-ink ${focusRing}`}>
      ↻ Run again
    </button>
  );
}

// ── Random walk (gambler's ruin) ──────────────────────────────────────────

function RandomWalk({ config }: { config: Config }) {
  const [start, setStart] = useState(num(config, "start", 3));
  const [upper, setUpper] = useState(num(config, "upper", 10));
  const [paths, setPaths] = useState(num(config, "paths", 200));
  const [seed, setSeed] = useState(num(config, "seed", 1));
  const [guess, setGuess] = useState("");
  const p = num(config, "p", 0.5);
  const k = Math.min(start, upper - 1);

  const sim = useMemo(() => {
    const rand = mulberry32(seed * 7919 + k * 31 + upper);
    const drawn: { pts: number[]; hitTop: boolean | null }[] = [];
    let top = 0;
    let broke = 0;
    let steps = 0;
    const cap = 40 * upper * upper;
    for (let i = 0; i < paths; i++) {
      let x = k;
      let n = 0;
      const pts = [x];
      while (x > 0 && x < upper && n < cap) {
        x += rand() < p ? 1 : -1;
        n++;
        if (i < 14 && pts.length < 70) pts.push(x);
      }
      steps += n;
      if (x >= upper) top++;
      else if (x <= 0) broke++;
      if (i < 14) drawn.push({ pts, hitTop: x >= upper ? true : x <= 0 ? false : null });
    }
    return { drawn, top, broke, avg: steps / paths };
  }, [seed, k, upper, paths, p]);

  const W = 780;
  const H = 250;
  const X = (i: number) => 44 + (i / 69) * (W - 60);
  const Y = (v: number) => 24 + (1 - v / upper) * (H - 48);
  return (
    <Frame
      title="Random-walk simulator"
      controls={
        <>
          <Select label="start" value={k} options={Array.from({ length: upper - 1 }, (_, i) => i + 1)} onChange={setStart} fmt={(v) => `£${v}`} />
          <Select label="upper" value={upper} options={[5, 8, 10, 15, 20]} onChange={(v) => { setUpper(v); setStart(Math.min(start, v - 1)); }} fmt={(v) => `£${v}`} />
          <Select label="paths" value={paths} options={[50, 200, 1000]} onChange={setPaths} />
          <Again onClick={() => setSeed((s) => s + 1)} />
        </>
      }
      stats={[
        { label: `reached £${upper} first`, value: `${sim.top} of ${paths} · ${((sim.top / paths) * 100).toFixed(1)}%`, color: "var(--level-ready)" },
        { label: "went broke", value: `${sim.broke} of ${paths}`, color: "var(--accent-red)" },
        { label: "average length", value: `${sim.avg.toFixed(1)} flips` },
        { label: "your guess before running", value: guess ? guess : "—" },
      ]}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${paths} random walks from £${k} between £0 and £${upper}; ${sim.top} reached the top first.`}>
        <line x1={44} x2={W - 16} y1={Y(upper)} y2={Y(upper)} stroke="var(--level-ready)" strokeDasharray="5 4" />
        <line x1={44} x2={W - 16} y1={Y(0)} y2={Y(0)} stroke="var(--accent-red)" strokeDasharray="5 4" />
        <text x={4} y={Y(upper) + 4} fontSize="10" fill="var(--level-ready)" fontFamily="var(--font-mono)">£{upper}</text>
        <text x={4} y={Y(k) + 4} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">£{k}</text>
        <text x={4} y={Y(0) + 4} fontSize="10" fill="var(--accent-red)" fontFamily="var(--font-mono)">£0</text>
        {sim.drawn.map((d, i) => (
          <polyline
            key={i}
            fill="none"
            strokeWidth={1.3}
            opacity={0.75}
            stroke={d.hitTop === true && d.pts.length < 70 ? "var(--level-ready)" : d.hitTop === false && d.pts.length < 70 ? "var(--accent-red)" : "var(--text-muted)"}
            points={d.pts.map((v, j) => `${X(j)},${Y(v)}`).join(" ")}
          />
        ))}
      </svg>
      <label className="flex items-center gap-2 px-3 pb-3 text-[11px] text-ink-3">
        Your guess for P(reach £{upper}):
        <input value={guess} onChange={(e) => setGuess(e.target.value.slice(0, 12))} className={`w-20 bg-elevated border border-line rounded px-2 py-[2px] font-mono text-ink ${focusRing}`} aria-label="Your guess" />
      </label>
    </Frame>
  );
}

// ── Bayes grid ────────────────────────────────────────────────────────────

function BayesGrid({ config }: { config: Config }) {
  const pop = num(config, "population", 1000);
  const [prior, setPrior] = useState(num(config, "prior", 0.01));
  const [sens, setSens] = useState(num(config, "sensitivity", 0.9));
  const [fpr, setFpr] = useState(num(config, "false_positive", 0.05));
  const seed = num(config, "seed", 1);

  const grid = useMemo(() => {
    const rand = mulberry32(seed);
    const ill = Math.round(pop * prior);
    const tp = Math.round(ill * sens);
    const fp = Math.round((pop - ill) * fpr);
    // Fixed shuffled positions so moving a slider changes colours, not layout.
    const order = Array.from({ length: pop }, (_, i) => i).sort(() => rand() - 0.5);
    const kind = new Array<number>(pop).fill(0); // 0 healthy −, 1 healthy +, 2 ill −, 3 ill +
    order.forEach((cell, rank) => {
      if (rank < tp) kind[cell] = 3;
      else if (rank < ill) kind[cell] = 2;
      else if (rank < ill + fp) kind[cell] = 1;
    });
    return { ill, tp, fp, kind };
  }, [pop, prior, sens, fpr, seed]);

  const cols = 50;
  const rows = Math.ceil(pop / cols);
  const colour = ["var(--border-strong)", "var(--accent-red)", "rgba(61,214,140,0.35)", "var(--level-ready)"];
  const post = grid.tp + grid.fp ? grid.tp / (grid.tp + grid.fp) : 0;
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 1 : 0)}%`;
  return (
    <Frame
      title="Bayes grid"
      controls={
        <>
          <Slider label="base rate" value={prior} min={0.001} max={0.2} step={0.001} onChange={setPrior} fmt={pct} />
          <Slider label="sensitivity" value={sens} min={0.5} max={1} step={0.01} onChange={setSens} fmt={pct} />
          <Slider label="false +" value={fpr} min={0} max={0.3} step={0.005} onChange={setFpr} fmt={pct} />
        </>
      }
      stats={[
        { label: "ill and positive", value: String(grid.tp), color: "var(--level-ready)" },
        { label: "healthy but positive", value: String(grid.fp), color: "var(--accent-red)" },
        { label: "all positives", value: String(grid.tp + grid.fp) },
        { label: "P(ill | positive)", value: post.toFixed(3), color: "var(--accent-blue)" },
      ]}
    >
      <svg viewBox={`0 0 ${cols * 14 + 8} ${rows * 14 + 8}`} className="w-full h-auto" role="img" aria-label={`${pop} people: ${grid.tp} ill and positive, ${grid.fp} healthy and positive.`}>
        {grid.kind.map((k, i) => (
          <circle key={i} cx={11 + (i % cols) * 14} cy={11 + Math.floor(i / cols) * 14} r={4.2} fill={colour[k]} />
        ))}
      </svg>
    </Frame>
  );
}

// ── Sampling explorer (order statistics) ──────────────────────────────────

function SamplingExplorer({ config }: { config: Config }) {
  const stat = config.statistic === "min" ? "min" : "max";
  const [n, setN] = useState(num(config, "n", 3));
  const [samples, setSamples] = useState(num(config, "samples", 4000));
  const [seed, setSeed] = useState(num(config, "seed", 1));
  const bins = 40;

  const sim = useMemo(() => {
    const rand = mulberry32(seed * 131 + n);
    const h = new Array<number>(bins).fill(0);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      let v = stat === "max" ? 0 : 1;
      for (let j = 0; j < n; j++) v = stat === "max" ? Math.max(v, rand()) : Math.min(v, rand());
      sum += v;
      h[Math.min(bins - 1, Math.floor(v * bins))]!++;
    }
    return { h, mean: sum / samples };
  }, [seed, n, samples, stat]);

  const W = 780;
  const H = 240;
  const density = (x: number) => (stat === "max" ? n * x ** (n - 1) : n * (1 - x) ** (n - 1));
  const maxD = Math.max(n, ...sim.h.map((c) => (c / samples) * bins)) * 1.08;
  const Y = (d: number) => H - 20 - (d / maxD) * (H - 36);
  const bw = (W - 40) / bins;
  const exact = stat === "max" ? n / (n + 1) : 1 / (n + 1);
  return (
    <Frame
      title="Sampling explorer"
      controls={
        <>
          <Select label="n" value={n} options={[1, 2, 3, 4, 5, 6, 8, 10, 20]} onChange={setN} />
          <Select label="samples" value={samples} options={[500, 4000, 20000]} onChange={setSamples} />
          <Again onClick={() => setSeed((s) => s + 1)} />
        </>
      }
      stats={[
        { label: "statistic", value: `${stat} of ${n} U(0,1)` },
        { label: "sample mean", value: sim.mean.toFixed(3), color: "var(--accent-blue)" },
        { label: `formula ${stat === "max" ? "n/(n+1)" : "1/(n+1)"}`, value: exact.toFixed(3), color: "var(--level-ready)" },
        { label: "samples", value: String(samples) },
      ]}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Histogram of the ${stat} of ${n} uniforms; sample mean ${sim.mean.toFixed(3)}.`}>
        {sim.h.map((c, i) => {
          const d = (c / samples) * bins;
          return <rect key={i} x={20 + i * bw + 1} y={Y(d)} width={bw - 2} height={H - 20 - Y(d)} fill="var(--accent-blue)" opacity={0.55} />;
        })}
        <polyline fill="none" stroke="var(--level-ready)" strokeWidth={2} points={Array.from({ length: 101 }, (_, i) => `${20 + (i / 100) * (W - 40)},${Y(density(i / 100))}`).join(" ")} />
        <line x1={20} x2={W - 20} y1={H - 20} y2={H - 20} stroke="var(--text-muted)" />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text key={t} x={20 + t * (W - 40)} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--text-muted)" fontFamily="var(--font-mono)">{t}</text>
        ))}
      </svg>
    </Frame>
  );
}

// ── Kelly growth ──────────────────────────────────────────────────────────

function KellyGrowth({ config }: { config: Config }) {
  const p = num(config, "p", 0.6);
  const b = num(config, "b", 1);
  const bets = num(config, "bets", 500);
  const paths = num(config, "paths", 200);
  const [f, setF] = useState(num(config, "fraction", 0.2));
  const [seed, setSeed] = useState(num(config, "seed", 1));
  const kelly = (b * p - (1 - p)) / b;

  const sim = useMemo(() => {
    const rand = mulberry32(seed);
    const drawn: number[][] = [];
    const finals: number[] = [];
    const every = Math.max(1, Math.floor(bets / 100));
    for (let i = 0; i < paths; i++) {
      let lw = 0;
      const pts = [0];
      for (let t = 1; t <= bets; t++) {
        const win = rand() < p;
        lw += win ? Math.log(1 + b * f) : f >= 1 ? -Infinity : Math.log(1 - f);
        if (i < 30 && t % every === 0) pts.push(Math.max(lw, -60));
      }
      finals.push(lw);
      if (i < 30) drawn.push(pts);
    }
    finals.sort((x, y) => x - y);
    return { drawn, median: finals[Math.floor(paths / 2)]!, ruined: finals.filter((v) => v < Math.log(0.01)).length };
  }, [seed, f, p, b, bets, paths]);

  const g = p * Math.log(1 + b * f) + (1 - p) * Math.log(Math.max(1e-12, 1 - f));
  const W = 780;
  const H = 240;
  const lo = -40;
  const hi = 40;
  const Y = (v: number) => 12 + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 24);
  const X = (i: number, n: number) => 30 + (i / Math.max(1, n - 1)) * (W - 46);
  return (
    <Frame
      title="Kelly growth"
      controls={
        <>
          <Slider label="bet fraction f" value={f} min={0} max={0.8} step={0.01} onChange={setF} fmt={(v) => v.toFixed(2)} />
          <Again onClick={() => setSeed((s) => s + 1)} />
        </>
      }
      stats={[
        { label: "growth per bet g(f)", value: g.toFixed(4), color: g > 0 ? "var(--level-ready)" : "var(--accent-red)" },
        { label: "Kelly fraction", value: kelly.toFixed(2), color: "var(--accent-blue)" },
        { label: `median log-wealth after ${bets}`, value: sim.median.toFixed(1) },
        { label: "paths below 1% of start", value: `${sim.ruined} of ${paths}`, color: sim.ruined ? "var(--accent-red)" : undefined },
      ]}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Log-wealth over ${bets} bets at fraction ${f.toFixed(2)}; median final log-wealth ${sim.median.toFixed(1)}.`}>
        <line x1={30} x2={W - 16} y1={Y(0)} y2={Y(0)} stroke="var(--text-muted)" strokeDasharray="4 4" />
        <text x={4} y={Y(0) + 4} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">0</text>
        <text x={4} y={Y(hi) + 8} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">+{hi}</text>
        <text x={4} y={Y(lo)} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">{lo}</text>
        {sim.drawn.map((pts, i) => (
          <polyline key={i} fill="none" strokeWidth={1.1} opacity={0.6} stroke={pts[pts.length - 1]! >= 0 ? "var(--level-ready)" : "var(--accent-red)"} points={pts.map((v, j) => `${X(j, pts.length)},${Y(v)}`).join(" ")} />
        ))}
      </svg>
    </Frame>
  );
}
