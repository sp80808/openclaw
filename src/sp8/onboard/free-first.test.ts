import { describe, expect, it } from "vitest";
import { buildFreeFirstPlan, recommendLocalProfile } from "./free-first.js";

describe("free-first onboarding", () => {
  it("recommends privacy-max for high-memory hosts", () => {
    expect(recommendLocalProfile({ ramGb: 64, cpuCount: 16 })).toBe("privacy-max");
  });

  it("produces zero-cloud plan in airgap mode", () => {
    const plan = buildFreeFirstPlan({
      hardware: { ramGb: 32, cpuCount: 12 },
      runtimes: { ollama: true, llamaCpp: false, vllm: false },
      profile: "zero-cloud",
      airgap: true,
    });

    expect(plan.cloudFallback).toEqual([]);
    expect(plan.airgap).toBe(true);
    expect(plan.nextSteps.some((line) => line.includes("SP8_AIRGAP=1"))).toBe(true);
  });

  it("includes free cloud fallback for non-airgap plans", () => {
    const plan = buildFreeFirstPlan({
      hardware: { ramGb: 16, cpuCount: 8 },
      runtimes: { ollama: false, llamaCpp: false, vllm: false },
      profile: "speed-demon",
      airgap: false,
    });

    expect(plan.cloudFallback.length).toBeGreaterThan(0);
    expect(plan.local.primaryModel).toContain("8b");
  });
});
