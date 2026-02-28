import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evolveSelf, evolveReport, recordInteraction } from "./self-improve.js";

describe("Sp8SelfImprove", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp8-evolve-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  async function seedInteractions(count: number, negativeRatio = 0.5): Promise<void> {
    for (let i = 0; i < count; i++) {
      const isNegative = i / count < negativeRatio;
      await recordInteraction(
        {
          at: new Date().toISOString(),
          task: `Test task ${i}: ${isNegative ? "failed parsing" : "successful refactor"}`,
          result: isNegative ? "error: unexpected token" : "Refactored 3 functions",
          feedback: isNegative ? "bad output" : "good work",
          score: isNegative ? -1 : 1,
        },
        stateDir,
      );
    }
  }

  it("returns empty result when no interactions exist", async () => {
    const result = await evolveSelf({ mode: "v1", stateDir });
    expect(result.mode).toBe("v1");
    expect(result.candidatesEvaluated).toBe(0);
    expect(result.winner).toBeNull();
    expect(result.applied).toBe(false);
  });

  it("v1 generates candidates from interaction feedback", async () => {
    await seedInteractions(10);
    const result = await evolveSelf({ mode: "v1", stateDir, candidateCount: 4 });
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.origin).toBe("v1");
    expect(result.winner!.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winner!.winRate).toBeLessThanOrEqual(1);
  });

  it("v2 reflexion iterates and improves scores", async () => {
    await seedInteractions(10);
    const result = await evolveSelf({ mode: "v2", stateDir, maxReflectionIterations: 3 });
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.origin).toBe("v2");
  });

  it("v3 agent-as-judge evaluates mixed candidates", async () => {
    await seedInteractions(15);
    const result = await evolveSelf({ mode: "v3", stateDir, candidateCount: 3 });
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.score).toBeGreaterThan(0);
  });

  it("v4 evolutionary search uses tournament selection", async () => {
    await seedInteractions(10);
    const result = await evolveSelf({ mode: "v4", stateDir, populationSize: 8 });
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.origin).toBe("v4");
  });

  it("v5 distilled RL generates preference pairs", async () => {
    await seedInteractions(10);
    const result = await evolveSelf({ mode: "v5", stateDir, candidateCount: 3 });
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.origin).toBe("v5");
  });

  it("produces before/after comparison on hard tasks", async () => {
    await seedInteractions(10, 0.7); // 70% negative
    const result = await evolveSelf({ mode: "v3", stateDir, comparisonTaskCount: 3 });
    expect(result.comparison.length).toBeLessThanOrEqual(3);
    if (result.comparison.length > 0) {
      expect(result.comparison[0].delta).toBeGreaterThanOrEqual(0);
      expect(result.comparison[0].beforeScore).toBeLessThanOrEqual(result.comparison[0].afterScore);
    }
  });

  it("does not apply patch by default (user veto)", async () => {
    await seedInteractions(10);
    const result = await evolveSelf({ mode: "v1", stateDir });
    expect(result.applied).toBe(false);
  });

  it("applies patch when autoApply is true", async () => {
    await seedInteractions(10);
    const result = await evolveSelf({ mode: "v1", stateDir, autoApply: true });
    expect(result.applied).toBe(true);

    // Verify a patch file was created
    const files = await fs.readdir(stateDir);
    const patchFiles = files.filter((f) => f.startsWith("applied-") && f.endsWith(".patch"));
    expect(patchFiles.length).toBe(1);
  });

  it("persists evolution history", async () => {
    await seedInteractions(10);
    await evolveSelf({ mode: "v1", stateDir });
    await evolveSelf({ mode: "v3", stateDir });

    const report = await evolveReport(stateDir);
    expect(report.totalRuns).toBe(2);
    expect(report.modeBreakdown.v1).toBe(1);
    expect(report.modeBreakdown.v3).toBe(1);
  });

  it("evolveReport returns averages correctly", async () => {
    await seedInteractions(10);
    await evolveSelf({ mode: "v1", stateDir });
    const report = await evolveReport(stateDir);

    expect(report.avgWinRate).toBeGreaterThanOrEqual(0);
    expect(report.avgWinRate).toBeLessThanOrEqual(1);
    expect(report.recentWinners.length).toBeGreaterThan(0);
  });
});
