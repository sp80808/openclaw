import fs from "node:fs/promises";
import path from "node:path";
import { done, entity, makeCard, relation, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";
import { detectUvtInstall, dropAssetForUvtAutoLoad } from "./uvt-bridge/index.js";

export async function runMemoGravity(params: {
  memo: string;
  mode: "voice" | "text";
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const memoId = `concept-memo-${Date.now()}`;
  const uvt = await detectUvtInstall();
  const outDir = path.join(params.context.workspaceDir, "studio", "memo-gravity");
  await fs.mkdir(outDir, { recursive: true });
  const assetPath = path.join(outDir, `${Date.now()}-idea.json`);
  await fs.writeFile(
    assetPath,
    `${JSON.stringify(
      {
        memo: params.memo,
        mode: params.mode,
        transformed: {
          patchIntent: "hybrid-granular-pad",
          setIntent: "peak-hour transition",
          sampleIntent: "vocal texture slice",
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  const dropPath = await dropAssetForUvtAutoLoad(uvt, {
    assetPath,
    presetName: "memogravity-idea",
    auditionMs: 6_000,
  });

  return done({
    skill: "MemoGravity",
    summary: "Converted memo into production assets and queued UVT autoload.",
    artifacts: [assetPath, dropPath],
    kgEntities: [
      entity({
        id: memoId,
        type: "progression",
        label: "Memo-derived asset concept",
        tags: ["memo", params.mode, "uvt"],
        properties: { memo: params.memo },
      }),
    ],
    kgRelations: [
      relation({
        id: `memo-load-${Date.now()}`,
        type: "references",
        from: memoId,
        to: "uvtpreset-memogravity",
      }),
    ],
    canvas: scene(
      "grid",
      [
        makeCard("memogravity-memo", "Memo", "card", { memo: params.memo, mode: params.mode }),
        makeCard("memogravity-asset", "Generated Asset", "timeline", { assetPath }),
      ],
      ["Memo capture to playable asset in one local pass"],
    ),
    startedAt,
  });
}
