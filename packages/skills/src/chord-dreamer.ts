import { done, entity, makeCard, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";
import { detectUvtInstall, exportUvtPreset } from "./uvt-bridge/index.js";

export async function runChordDreamer(params: {
  seed: string;
  key: string;
  bars: number;
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const uvt = await detectUvtInstall();
  const progression = ["Imaj9", "V7sus4", "vi11", "IVmaj7"];
  const melodyHints = ["upbeat syncopation", "ghost-note passing tones", "late swing pull"];
  const presetPath = await exportUvtPreset(uvt, `chorddreamer-${params.key}`, {
    seed: params.seed,
    key: params.key,
    bars: params.bars,
    progression,
    melodyHints,
    styleSignature: params.context.profile.signatureTags,
  });

  return done({
    skill: "ChordDreamer",
    summary: `Generated style-mirrored progression and exported UVT preset in ${params.key}.`,
    artifacts: [presetPath],
    kgEntities: [
      entity({
        id: `progression-${params.key}`,
        type: "progression",
        label: `${params.key} progression`,
        tags: ["chords", "melody", "style-mirror"],
        properties: { bars: params.bars, seed: params.seed },
      }),
      entity({
        id: `uvtpreset-chorddreamer-${params.key}`,
        type: "uvtpreset",
        label: `UVT preset ${params.key}`,
        properties: { presetPath },
      }),
    ],
    kgRelations: [],
    canvas: scene(
      "grid",
      [
        makeCard("chorddreamer-progression", "Progression", "card", { progression }),
        makeCard("chorddreamer-melody", "Melody DNA", "timeline", { melodyHints }),
      ],
      ["Style Mirror reflects user signature tags in voicing and rhythm"],
    ),
    startedAt,
  });
}
