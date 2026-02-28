import { Sp8Router, type Sp8TaskType } from "./sp8-router.js";

export type FusionCandidate = {
  source: string;
  text: string;
};

export function fuseConsensus(prompt: string, candidates: FusionCandidate[]): string {
  const uniq = new Map<string, FusionCandidate>();
  for (const candidate of candidates) {
    const key = candidate.text.trim();
    if (!key) {
      continue;
    }
    if (!uniq.has(key)) {
      uniq.set(key, candidate);
    }
  }
  const merged = [...uniq.values()]
    .map((entry) => `- [${entry.source}] ${entry.text.trim()}`)
    .join("\n");
  return [
    `Consensus for: ${prompt}`,
    "",
    "Synthesize the strongest overlapping points and keep disagreements explicit.",
    merged,
  ].join("\n");
}

export async function runParallelMultimodal(params: {
  router: Sp8Router;
  task: Sp8TaskType;
  prompt: string;
  fanout: 2 | 3 | 4;
  runOpenRouter: (modelId: string, prompt: string) => Promise<string>;
  runGeminiCli: (prompt: string) => Promise<string>;
}): Promise<{ fused: string; candidates: FusionCandidate[] }> {
  const modelPicks = params.router.pickModels(params.task, params.fanout);
  const jobs: Array<Promise<FusionCandidate>> = modelPicks.map(async (model) => ({
    source: `openrouter:${model.id}`,
    text: await params.runOpenRouter(model.id, params.prompt),
  }));

  jobs.push(
    (async () => ({
      source: "gemini-cli",
      text: await params.runGeminiCli(params.prompt),
    }))(),
  );

  const settled = await Promise.allSettled(jobs);
  const candidates = settled
    .filter(
      (entry): entry is PromiseFulfilledResult<FusionCandidate> => entry.status === "fulfilled",
    )
    .map((entry) => entry.value);

  if (candidates.length === 0) {
    throw new Error("parallel multimodal execution failed: no successful candidates");
  }

  return {
    candidates,
    fused: fuseConsensus(params.prompt, candidates),
  };
}
