/**
 * Tech spec §7 — xoshiro128**, seeded from FNV-1a over "{template_id}:{version}:{seed}".
 *
 * Hand-rolled and frozen. Changing anything here changes every instance every
 * user has ever seen; test/prng.test.ts pins the output against a fixture.
 */

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  // Hash UTF-16 code units as bytes of their UTF-8 encoding would differ for
  // non-ASCII; ids are ASCII by construction, and the fixture pins this choice.
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** splitmix32 — expands one 32-bit hash into the four words of xoshiro state. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Prng {
  private s: Uint32Array;

  constructor(seedHash: number) {
    const sm = splitmix32(seedHash);
    this.s = new Uint32Array([sm(), sm(), sm(), sm()]);
    if (this.s.every((w) => w === 0)) this.s[0] = 1;
  }

  static forInstance(templateId: string, version: number, seed: number, stream = ""): Prng {
    return new Prng(fnv1a32(`${templateId}:${version}:${seed}${stream ? `:${stream}` : ""}`));
  }

  /** next 32-bit unsigned integer */
  nextU32(): number {
    const st = this.s;
    let s0 = st[0]!, s1 = st[1]!, s2 = st[2]!, s3 = st[3]!;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    st[0] = s0; st[1] = s1; st[2] = s2; st[3] = s3;
    return result;
  }

  /** uniform in [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** uniform integer in [min, max], inclusive */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)]!;
  }

  shuffle<T>(values: readonly T[]): T[] {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
