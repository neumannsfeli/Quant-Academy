/**
 * Read-mostly content, cached per process. Content rows are immutable per
 * version, so a short TTL cache is safe across instances (tech spec §16.3 item 1
 * forbids caches that matter; this one only saves queries).
 */
import { getDb, schema as s } from "@qa/db";
import type { ItemTemplate } from "@qa/items";
import type { Lesson } from "@qa/learning";
import type { Archetype, Band, SkillMeta } from "@qa/scoring";
import { config } from "./config";

export type SkillInfo = SkillMeta & {
  name: string;
  domainName: string;
  band: Band;
  lessonMinutes: number;
  tier: number;
  dependentIds: string[];
};

export type DomainInfo = { id: string; name: string; short: string; position: number; live: boolean; hubSkillId: string | null };

export type TemplateRow = {
  id: string;
  version: number;
  skillId: string;
  band: Band;
  type: ItemTemplate["type"];
  status: string;
  placement: boolean;
  timeLimitSec: number;
  payload: ItemTemplate;
  serveable: boolean;
  sweepPassed: boolean;
};

export type ArchetypeInfo = Archetype & { name: string; firms: string | null; selectable: boolean; note: string | null };
export type MisconceptionInfo = { id: string; skillId: string; label: string; explanation: string };
export type LessonInfo = Lesson;

export type Content = {
  loadedAt: number;
  domains: DomainInfo[];
  domainById: Map<string, DomainInfo>;
  skills: Map<string, SkillInfo>;
  skillList: SkillInfo[];
  archetypes: Map<string, ArchetypeInfo>;
  misconceptions: Map<string, MisconceptionInfo>;
  /** serveable practice templates, latest version of each id */
  templatesBySkill: Map<string, TemplateRow[]>;
  /** every stored version, keyed `${id}@${version}` — for grading and replay */
  templateByKey: Map<string, TemplateRow>;
  lessons: Map<string, LessonInfo>;
  readings: Map<string, { kind: string; body: string }>;
};

const TTL_MS = 30_000;
let cached: Content | null = null;
let inflight: Promise<Content> | null = null;

export function invalidateContent() {
  cached = null;
}

export async function getContent(now = Date.now()): Promise<Content> {
  if (cached && now - cached.loadedAt < TTL_MS) return cached;
  if (!inflight) {
    inflight = loadContent().finally(() => {
      inflight = null;
    });
  }
  cached = await inflight;
  return cached;
}

export const templateKey = (id: string, version: number) => `${id}@${version}`;

async function loadContent(): Promise<Content> {
  const db = getDb();
  const [domains, skills, prereqs, archetypes, misconceptions, templates, lessons, readings] = await Promise.all([
    db.select().from(s.domains).orderBy(s.domains.position),
    db.select().from(s.skills),
    db.select().from(s.skillPrereqs),
    db.select().from(s.archetypes),
    db.select().from(s.misconceptions),
    db.select().from(s.itemTemplates),
    db.select().from(s.lessons),
    db.select().from(s.readings),
  ]);
  const domainById = new Map(domains.map((d) => [d.id, d]));
  const prereqMap = new Map<string, string[]>();
  const depMap = new Map<string, string[]>();
  for (const e of prereqs) {
    prereqMap.set(e.skillId, [...(prereqMap.get(e.skillId) ?? []), e.prereqId]);
    depMap.set(e.prereqId, [...(depMap.get(e.prereqId) ?? []), e.skillId]);
  }
  const skillList: SkillInfo[] = skills
    .map((k) => ({
      id: k.id,
      domainId: k.domainId,
      domainName: domainById.get(k.domainId)?.name ?? k.domainId,
      name: k.name,
      band: k.band as Band,
      importance: k.importance as 1 | 2 | 3,
      lessonMinutes: k.lessonMinutes,
      tier: k.tier,
      prereqIds: (prereqMap.get(k.id) ?? []).sort(),
      dependentIds: (depMap.get(k.id) ?? []).sort(),
    }))
    .sort((a, b) => (domainById.get(a.domainId)?.position ?? 0) - (domainById.get(b.domainId)?.position ?? 0) || a.tier - b.tier || a.name.localeCompare(b.name));

  const allowed = new Set(config.serveUnreviewed ? ["live", "in_review"] : ["live"]);
  const templateByKey = new Map<string, TemplateRow>();
  const latest = new Map<string, TemplateRow>();
  for (const t of templates) {
    const row: TemplateRow = {
      id: t.id,
      version: t.version,
      skillId: t.skillId,
      band: t.band as Band,
      type: t.type as TemplateRow["type"],
      status: t.status,
      placement: t.placement,
      timeLimitSec: t.timeLimitSec,
      payload: t.payload as ItemTemplate,
      serveable: !!t.sweep?.serveable && t.usage === "practice" && allowed.has(t.status),
      sweepPassed: !!t.sweep?.passed,
    };
    templateByKey.set(templateKey(t.id, t.version), row);
    const prev = latest.get(t.id);
    if (!prev || prev.version < t.version) latest.set(t.id, row);
  }
  const templatesBySkill = new Map<string, TemplateRow[]>();
  for (const t of latest.values()) {
    if (!t.serveable) continue;
    templatesBySkill.set(t.skillId, [...(templatesBySkill.get(t.skillId) ?? []), t]);
  }

  const lessonAllowed = new Set(config.serveUnreviewed ? ["live", "in_review"] : ["live"]);
  const lessonMap = new Map<string, LessonInfo>();
  for (const l of lessons) {
    if (!lessonAllowed.has(l.status)) continue;
    const prev = lessonMap.get(l.skillId);
    if (prev && prev.version > l.version) continue;
    lessonMap.set(l.skillId, {
      skill_id: l.skillId,
      version: l.version,
      title: l.title,
      est_minutes: l.estMinutes,
      key_results: l.keyResults,
      steps: l.steps as Lesson["steps"],
      status: l.status as Lesson["status"],
    });
  }

  return {
    loadedAt: Date.now(),
    domains,
    domainById,
    skills: new Map(skillList.map((k) => [k.id, k])),
    skillList,
    archetypes: new Map(
      archetypes.map((a) => [
        a.id,
        { id: a.id, name: a.name, firms: a.firms, selectable: a.selectable, note: a.note, weights: a.weights, required: a.requiredSkills as Record<string, Band> },
      ]),
    ),
    misconceptions: new Map(misconceptions.map((m) => [m.id, m])),
    templatesBySkill,
    templateByKey,
    lessons: lessonMap,
    readings: new Map(readings.map((r) => [r.skillId, { kind: r.kind, body: r.body }])),
  };
}

export const DEFAULT_ARCHETYPE = "puzzle-trading";

export function archetypeFor(content: Content, id: string | null | undefined): ArchetypeInfo {
  return content.archetypes.get(id ?? DEFAULT_ARCHETYPE) ?? content.archetypes.get(DEFAULT_ARCHETYPE)!;
}

/** Only domains the profile weighs, in display order. */
export function requiredDomains(content: Content, arch: ArchetypeInfo): DomainInfo[] {
  return content.domains.filter((d) => (arch.weights[d.id] ?? 0) > 0);
}
