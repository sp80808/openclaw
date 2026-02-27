import fs from "node:fs/promises";
import path from "node:path";
import { done, entity, makeCard, relation, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";
import { auditionInUvt, detectUvtInstall, dropAssetForUvtAutoLoad } from "./uvt-bridge/index.js";

export async function runPluginForge(params: {
  prompt: string;
  target: "maxmsp" | "vst" | "webaudio";
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const uvt = await detectUvtInstall();
  const outDir = path.join(params.context.workspaceDir, "studio", "pluginforge");
  await fs.mkdir(outDir, { recursive: true });
  const patchPath = path.join(outDir, `${params.target}-patch.json`);
  await fs.writeFile(
    patchPath,
    `${JSON.stringify(
      {
        target: params.target,
        prompt: params.prompt,
        generator: "PluginForge",
        styleMirror: params.context.profile.signatureTags,
        swarm: params.context.swarm,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  const dropPath = await dropAssetForUvtAutoLoad(uvt, {
    assetPath: patchPath,
    presetName: `pluginforge-${params.target}`,
    auditionMs: 10_000,
  });
  await auditionInUvt(uvt, dropPath, 10_000);

  return done({
    skill: "PluginForge",
    summary: `Generated ${params.target} patch and auto-auditioned in UVT.`,
    artifacts: [patchPath, dropPath],
    kgEntities: [
      entity({
        id: `pluginpatch-${path.basename(patchPath, ".json")}`,
        type: "pluginpatch",
        label: `Plugin patch (${params.target})`,
        tags: ["pluginforge", params.target],
        properties: { prompt: params.prompt },
      }),
    ],
    kgRelations: [
      relation({
        id: "pluginpatch-uses-uvtpreset",
        type: "references",
        from: `pluginpatch-${path.basename(patchPath, ".json")}`,
        to: "uvtpreset-pluginforge-default",
      }),
    ],
    canvas: scene(
      "grid",
      [
        makeCard("pluginforge-patch", "Plugin Patch", "card", { patchPath, target: params.target }),
        makeCard("pluginforge-audition", "UVT Audition", "timeline", { dropPath, seconds: 10 }),
      ],
      ["Clean Antigravity cards only", "No audio physics simulation"],
    ),
    startedAt,
  });
}
