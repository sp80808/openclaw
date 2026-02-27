import fs from "node:fs/promises";
import path from "node:path";
import { done, entity, makeCard, relation, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";

export async function runSetForge(params: {
  setName: string;
  tracks: Array<{ title: string; key: string; energy: number }>;
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const sorted = [...params.tracks].sort((a, b) => a.energy - b.energy);
  const outDir = path.join(params.context.workspaceDir, "studio", "sets");
  await fs.mkdir(outDir, { recursive: true });
  const setPath = path.join(
    outDir,
    `${params.setName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
  );
  await fs.writeFile(
    setPath,
    `${JSON.stringify(
      {
        setName: params.setName,
        arc: "harmonic-energy-ramp",
        tracks: sorted,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  return done({
    skill: "SetForge",
    summary: `Built DJ set \"${params.setName}\" with harmonic + energy arc.`,
    artifacts: [setPath],
    kgEntities: [
      entity({
        id: `set-${params.setName}`,
        type: "set",
        label: params.setName,
        tags: ["dj", "arc"],
        properties: { size: sorted.length },
      }),
      ...sorted.map((track, index) =>
        entity({
          id: `track-${index + 1}`,
          type: "track",
          label: track.title,
          properties: { key: track.key, energy: track.energy },
        }),
      ),
    ],
    kgRelations: sorted.map((_, index) =>
      relation({
        id: `set-order-${index + 1}`,
        type: "references",
        from: `set-${params.setName}`,
        to: `track-${index + 1}`,
        weight: index + 1,
      }),
    ),
    canvas: scene(
      "timeline",
      [makeCard("setforge-arc", "Energy Arc", "timeline", { tracks: sorted })],
      ["Timeline cards emphasize transitions and crowd energy pacing"],
    ),
    startedAt,
  });
}
