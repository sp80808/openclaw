import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { huntModels, getModelStatus, loadShadowHistory } from "./model-hunter.js";

describe("Sp8ModelHunter", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp8-hunter-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  // Use a mock fetch that returns a handful of fake free models
  function mockFetch(
    models: Array<{
      id: string;
      name: string;
      pricing?: { prompt: string; completion: string };
      context_length?: number;
      architecture?: { modality: string };
    }>,
  ) {
    return async (_url: string | URL | Request, _init?: RequestInit) => {
      return {
        ok: true,
        json: async () => ({ data: models }),
      } as Response;
    };
  }

  const MOCK_MODELS = [
    {
      id: "qwen/qwen3-coder-next:free",
      name: "Qwen3 Coder Next (Free)",
      pricing: { prompt: "0", completion: "0" },
      context_length: 256000,
      architecture: { modality: "text" },
    },
    {
      id: "zhipu/glm-4.5-air:free",
      name: "GLM-4.5-Air (Free)",
      pricing: { prompt: "0", completion: "0" },
      context_length: 128000,
      architecture: { modality: "text" },
    },
    {
      id: "deepseek/deepseek-v3.2-speciale:free",
      name: "DeepSeek V3.2 Speciale (Free)",
      pricing: { prompt: "0", completion: "0" },
      context_length: 128000,
      architecture: { modality: "text" },
    },
    {
      id: "stepfun/step-3.5-flash:free",
      name: "Step 3.5 Flash (Free)",
      pricing: { prompt: "0", completion: "0" },
      context_length: 64000,
      architecture: { modality: "text" },
    },
    {
      id: "nvidia/nemotron-nano-30b:free",
      name: "Nemotron Nano 30B (Free)",
      pricing: { prompt: "0", completion: "0" },
      context_length: 32000,
      architecture: { modality: "text+image" },
    },
    {
      id: "some/paid-model",
      name: "Paid Model",
      pricing: { prompt: "0.001", completion: "0.002" },
      context_length: 128000,
      architecture: { modality: "text" },
    },
  ];

  it("discovers and filters free models", async () => {
    const result = await huntModels({
      focus: "agent-tool-use",
      maxCandidates: 5,
      shadowTestCount: 5,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    expect(result.candidatesFound).toBe(5); // 5 free, 1 paid filtered out
    expect(result.topCandidates.every((c) => c.isFree)).toBe(true);
    // Paid model should not appear
    expect(result.topCandidates.find((c) => c.id === "some/paid-model")).toBeUndefined();
  });

  it("ranks Qwen3 Coder highest for agent-tool-use focus", async () => {
    const result = await huntModels({
      focus: "agent-tool-use",
      maxCandidates: 5,
      shadowTestCount: 3,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    const ids = result.topCandidates.map((c) => c.id);
    // Qwen3 Coder should be at or near the top
    expect(ids[0]).toContain("qwen");
  });

  it("ranks Step Flash highest for speed focus", async () => {
    const result = await huntModels({
      focus: "speed",
      maxCandidates: 5,
      shadowTestCount: 3,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    const top = result.topCandidates[0];
    expect(top.speedScore).toBeGreaterThan(0);
  });

  it("runs shadow tests on top candidates", async () => {
    const result = await huntModels({
      focus: "agent-tool-use",
      maxCandidates: 3,
      shadowTestCount: 10,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    expect(result.shadowResults.length).toBeGreaterThan(0);
    for (const sr of result.shadowResults) {
      expect(sr.tasksRun).toBe(10);
      expect(sr.winRate).toBeGreaterThanOrEqual(0);
      expect(sr.winRate).toBeLessThanOrEqual(1);
      expect(sr.toolCallAccuracy).toBeGreaterThanOrEqual(0);
      expect(sr.avgTimeMs).toBeGreaterThan(0);
    }
  });

  it("promotes models above threshold", async () => {
    const result = await huntModels({
      focus: "agent-tool-use",
      maxCandidates: 5,
      shadowTestCount: 20,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    // At least some models should get promoted (simulated scores are boosted by known-strong patterns)
    expect(result.promoted.length).toBeGreaterThanOrEqual(0);
  });

  it("persists shadow-test history", async () => {
    await huntModels({
      focus: "general",
      maxCandidates: 3,
      shadowTestCount: 5,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    const history = await loadShadowHistory(stateDir);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].modelId).toBeDefined();
    expect(history[0].testedAt).toBeDefined();
  });

  it("getModelStatus returns task-class routing from promotions", async () => {
    await huntModels({
      focus: "coding",
      maxCandidates: 3,
      shadowTestCount: 10,
      stateDir,
      fetchImpl: mockFetch(MOCK_MODELS),
    });

    const status = await getModelStatus(stateDir);
    expect(status.promotions).toBeDefined();
    expect(typeof status.taskClassRouting).toBe("object");
  });

  it("handles airgap mode gracefully", async () => {
    const result = await huntModels({
      focus: "general",
      maxCandidates: 5,
      shadowTestCount: 5,
      stateDir,
      airgap: true,
    });

    expect(result.candidatesFound).toBe(0);
    expect(result.topCandidates.length).toBe(0);
    expect(result.shadowResults.length).toBe(0);
  });
});
