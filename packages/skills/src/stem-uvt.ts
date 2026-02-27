import path from "node:path";
import { done, entity, makeCard, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";
import { detectUvtInstall, dropAssetForUvtAutoLoad, runUvtCli } from "./uvt-bridge/index.js";

export async function runStemUVT(params: {
  inputTrackPath: string;
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const uvt = await detectUvtInstall();
  const result = await runUvtCli(uvt, [
    "stems",
    "separate",
    "--input",
    params.inputTrackPath,
    "--output-dir",
    path.join(params.context.workspaceDir, "studio", "stems"),
  ]);
  if (result.code !== 0) {
    throw new Error(`StemUVT failed: ${result.stderr || result.stdout}`);
  }

  const stemFolder = path.join(params.context.workspaceDir, "studio", "stems");
  const dropPath = await dropAssetForUvtAutoLoad(uvt, {
    assetPath: stemFolder,
    presetName: "stemuvt-preview",
    auditionMs: 8_000,
  });

  return done({
    skill: "StemUVT",
    summary: "Separated stems via local UVT and queued autoload preview.",
    artifacts: [stemFolder, dropPath],
    kgEntities: [
      entity({
        id: "stem-main",
        type: "stem",
        label: "Primary stem output",
        tags: ["uvt", "separation"],
        properties: { sourceTrack: params.inputTrackPath },
      }),
    ],
    kgRelations: [],
    canvas: scene(
      "timeline",
      [
        makeCard("stem-track", "Source Track", "card", { input: params.inputTrackPath }),
        makeCard("stem-preview", "Stem Preview", "spectrogram", { folder: stemFolder }),
      ],
      ["Stem layers visualized as spectrogram cards"],
    ),
    startedAt,
  });
}
