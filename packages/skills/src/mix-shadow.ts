import { done, entity, makeCard, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";

export async function runMixShadow(params: {
  trackName: string;
  lufs: number;
  peakDb: number;
  stereoWidth: number;
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const suggestions: string[] = [];
  if (params.lufs > -8) {
    suggestions.push("Lower bus compression to recover dynamics.");
  }
  if (params.peakDb > -0.5) {
    suggestions.push("Add limiter ceiling margin to -1.0dBTP.");
  }
  if (params.stereoWidth > 1.6) {
    suggestions.push("Tighten side image below 200Hz.");
  }
  if (suggestions.length === 0) {
    suggestions.push("Mix profile is stable for club translation.");
  }

  return done({
    skill: "MixShadow",
    summary: `Mix analysis complete for ${params.trackName}.`,
    artifacts: [],
    kgEntities: [
      entity({
        id: `track-${params.trackName}`,
        type: "track",
        label: params.trackName,
        tags: ["mix-analysis"],
        properties: {
          lufs: params.lufs,
          peakDb: params.peakDb,
          stereoWidth: params.stereoWidth,
          suggestions,
        },
      }),
    ],
    kgRelations: [],
    canvas: scene(
      "grid",
      [
        makeCard("mixshadow-spectrum", "Spectrum", "spectrogram", {
          track: params.trackName,
          lufs: params.lufs,
          peakDb: params.peakDb,
        }),
        makeCard("mixshadow-notes", "Suggestions", "card", { suggestions }),
      ],
      ["Visual-first recommendations for fast decision-making"],
    ),
    startedAt,
  });
}
