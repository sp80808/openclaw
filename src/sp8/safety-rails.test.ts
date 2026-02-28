import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyTask,
  routeTask,
  recordFallbackEvent,
  generateMetrics,
  loadSafetyConfig,
  saveSafetyConfig,
  renderWinRateChart,
} from "./safety-rails.js";

describe("Sp8SafetyRails", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp8-rails-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  describe("classifyTask", () => {
    it("classifies coding tasks", () => {
      expect(classifyTask("write code for a REST API")).toBe("coding");
      expect(classifyTask("implement the login function")).toBe("coding");
      expect(classifyTask("refactor the database module")).toBe("coding");
    });

    it("classifies reasoning tasks", () => {
      expect(classifyTask("analyze the performance data")).toBe("reasoning");
      expect(classifyTask("think step by step about this")).toBe("reasoning");
      expect(classifyTask("calculate the total cost")).toBe("reasoning");
    });

    it("classifies planning tasks", () => {
      expect(classifyTask("create a roadmap for Q3")).toBe("planning");
      expect(classifyTask("outline the steps to deploy")).toBe("planning");
    });

    it("classifies vision tasks", () => {
      expect(classifyTask("analyze this screenshot")).toBe("vision");
      expect(classifyTask("describe the image")).toBe("vision");
    });

    it("classifies speed tasks", () => {
      expect(classifyTask("quick answer: what is 2+2")).toBe("speed");
      expect(classifyTask("tl;dr of the README")).toBe("speed");
    });

    it("classifies agent tasks", () => {
      expect(classifyTask("search for files matching *.ts")).toBe("agent");
      expect(classifyTask("run the terminal command")).toBe("agent");
    });

    it("defaults to general", () => {
      expect(classifyTask("hello world")).toBe("general");
    });
  });

  describe("routeTask", () => {
    it("routes to first available model when no promotions exist", async () => {
      const decision = await routeTask("hello", ["model-a", "model-b"], stateDir);
      expect(decision.primaryModel).toBe("model-a");
      expect(decision.taskClass).toBe("general");
      expect(decision.confidence).toBeLessThan(0.5);
    });

    it("provides fallback chain", async () => {
      const decision = await routeTask("write code", ["m1", "m2", "m3", "m4"], stateDir);
      expect(decision.fallbackChain.length).toBeLessThanOrEqual(3);
      expect(decision.fallbackChain).not.toContain(decision.primaryModel);
    });
  });

  describe("fallback events", () => {
    it("records fallback events", async () => {
      const result = await recordFallbackEvent(
        {
          at: new Date().toISOString(),
          modelId: "test-model",
          reason: "429",
          consecutiveCount: 1,
        },
        stateDir,
      );
      expect(result.shouldNotify).toBe(false);
    });

    it("notifies when consecutive failures exceed threshold", async () => {
      const result = await recordFallbackEvent(
        {
          at: new Date().toISOString(),
          modelId: "test-model",
          reason: "429",
          consecutiveCount: 3,
        },
        stateDir,
      );
      expect(result.shouldNotify).toBe(true);
      expect(result.message).toContain("test-model");
    });
  });

  describe("safety config", () => {
    it("returns defaults when no config file exists", async () => {
      const config = await loadSafetyConfig(stateDir);
      expect(config.maxConsecutive429s).toBe(3);
      expect(config.autoApplyEvolve).toBe(false);
      expect(config.autoPromoteModels).toBe(false);
      expect(config.notifyOnChanges).toBe(true);
    });

    it("saves and loads config", async () => {
      await saveSafetyConfig({ autoApplyEvolve: true, maxConsecutive429s: 5 }, stateDir);
      const config = await loadSafetyConfig(stateDir);
      expect(config.autoApplyEvolve).toBe(true);
      expect(config.maxConsecutive429s).toBe(5);
      // Defaults preserved
      expect(config.notifyOnChanges).toBe(true);
    });
  });

  describe("metrics", () => {
    it("generates empty metrics when no data", async () => {
      const metrics = await generateMetrics(stateDir);
      expect(metrics.health.totalModelsTracked).toBe(0);
      expect(metrics.fallbackEvents.length).toBe(0);
    });
  });

  describe("renderWinRateChart", () => {
    it("renders ascii chart with data", () => {
      const chart = renderWinRateChart([
        { label: "02-25", value: 0.6 },
        { label: "02-26", value: 0.75 },
        { label: "02-27", value: 0.82 },
      ]);
      expect(chart).toContain("Win Rate Over Time");
      expect(chart).toContain("82%");
      expect(chart).toContain("█");
    });

    it("handles empty data", () => {
      const chart = renderWinRateChart([]);
      expect(chart).toContain("No data");
    });
  });
});
