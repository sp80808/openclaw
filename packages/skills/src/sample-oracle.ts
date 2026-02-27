import fs from "node:fs/promises";
import path from "node:path";
import { done, entity, makeCard, scene } from "./base.js";
import type { SkillExecutionContext, SkillExecutionResult } from "./types.js";
import { detectUvtInstall } from "./uvt-bridge/index.js";

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && /\.(wav|aiff|flac|mp3)$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

export async function runSampleOracle(params: {
  query: string;
  context: SkillExecutionContext;
}): Promise<SkillExecutionResult> {
  const startedAt = Date.now();
  const uvt = await detectUvtInstall();
  const localSamples = await collectFiles(path.join(params.context.workspaceDir, "samples"));
  const uvtSamples = await collectFiles(uvt.soundbanksDir);
  const hits = [...localSamples, ...uvtSamples]
    .filter((file) => file.toLowerCase().includes(params.query.toLowerCase()))
    .slice(0, 24);

  return done({
    skill: "SampleOracle",
    summary: `Found ${hits.length} local samples for \"${params.query}\" including UVT soundbanks.`,
    artifacts: hits,
    kgEntities: hits.slice(0, 8).map((file, index) =>
      entity({
        id: `sample-${index + 1}`,
        type: "sample",
        label: path.basename(file),
        tags: ["sample", file.startsWith(uvt.soundbanksDir) ? "uvt-soundbank" : "local"],
        properties: { file },
      }),
    ),
    kgRelations: [],
    canvas: scene(
      "grid",
      [
        makeCard("sampleoracle-query", "Sample Query", "card", { query: params.query }),
        makeCard("sampleoracle-results", "Matches", "timeline", { hits: hits.slice(0, 10) }),
      ],
      ["Local + UVT soundbank search only"],
    ),
    startedAt,
  });
}
