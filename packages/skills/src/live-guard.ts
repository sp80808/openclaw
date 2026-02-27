import fs from "node:fs/promises";
import path from "node:path";
import { done, entity, makeCard, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";

export async function runLiveGuard(params: {
  setName: string;
  crowdEnergy: number;
  latencyMs: number;
  clipping: boolean;
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const level = params.clipping || params.latencyMs > 30 ? "warning" : "ok";
  const suggestions = [
    params.crowdEnergy < 0.45 ? "Push next transition 8 bars earlier" : "Hold groove for 16 bars",
    params.clipping ? "Drop master by -2.5dB immediately" : "Headroom stable",
  ];
  const logDir = path.join(params.context.workspaceDir, "studio", "performance");
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(
    logDir,
    `${params.setName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jsonl`,
  );
  await fs.appendFile(
    logPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      crowdEnergy: params.crowdEnergy,
      latencyMs: params.latencyMs,
      clipping: params.clipping,
      suggestions,
    })}\n`,
    "utf-8",
  );

  return done({
    skill: "LiveGuard",
    summary: `Live guard ${level}: ${suggestions[0]}.`,
    artifacts: [logPath],
    kgEntities: [
      entity({
        id: `performancelog-${Date.now()}`,
        type: "performancelog",
        label: `Live log ${params.setName}`,
        tags: ["live", level],
        properties: { crowdEnergy: params.crowdEnergy, latencyMs: params.latencyMs },
      }),
    ],
    kgRelations: [],
    canvas: scene(
      "timeline",
      [
        makeCard("liveguard-metrics", "Realtime Metrics", "timeline", {
          crowdEnergy: params.crowdEnergy,
          latencyMs: params.latencyMs,
          clipping: params.clipping,
        }),
      ],
      suggestions,
    ),
    startedAt,
  });
}
