import type {
  CanvasCard,
  CanvasScene,
  KgEntityRecord,
  KgRelationRecord,
  SkillExecutionResult,
  SkillName,
} from "./types.js";

export function makeCard(
  id: string,
  title: string,
  kind: "card" | "timeline" | "spectrogram",
  payload: Record<string, unknown>,
  subtitle?: string,
): CanvasCard {
  return { id, title, subtitle, kind, payload };
}

export function scene(
  layout: "grid" | "timeline",
  visuals: CanvasCard[],
  notes: string[],
): CanvasScene {
  return { layout, visuals, notes };
}

export function entity(record: KgEntityRecord): KgEntityRecord {
  return record;
}

export function relation(record: KgRelationRecord): KgRelationRecord {
  return record;
}

export function done(params: {
  skill: SkillName;
  summary: string;
  artifacts: string[];
  kgEntities: KgEntityRecord[];
  kgRelations: KgRelationRecord[];
  canvas: CanvasScene;
  startedAt: number;
}): SkillExecutionResult {
  return {
    skill: params.skill,
    summary: params.summary,
    artifacts: params.artifacts,
    kgEntities: params.kgEntities,
    kgRelations: params.kgRelations,
    canvas: params.canvas,
    telemetry: {
      elapsedMs: Date.now() - params.startedAt,
      localOnly: true,
    },
  };
}
