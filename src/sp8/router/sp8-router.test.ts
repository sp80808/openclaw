import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Sp8Router } from "./sp8-router.js";

describe("Sp8Router", () => {
  it("loads free models and ranks queues", async () => {
    const router = new Sp8Router({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "acme/reasoner:free",
                name: "Reasoner",
                pricing: { prompt: "0", completion: "0" },
              },
              {
                id: "acme/vision-lite:free",
                name: "Vision Lite",
                pricing: { prompt: "0", completion: "0" },
              },
              {
                id: "acme/flash-mini:free",
                name: "Flash Mini",
                pricing: { prompt: "0", completion: "0" },
              },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    await router.initialize();
    const status = router.getStatus();
    expect(status.freeModels).toBe(3);
    expect(status.queues.reasoning.length).toBeGreaterThan(0);
  });

  it("fails over on retriable errors", async () => {
    const router = new Sp8Router({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "acme/model-a:free", pricing: { prompt: "0", completion: "0" } },
              { id: "acme/model-b:free", pricing: { prompt: "0", completion: "0" } },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    let calls = 0;
    const result = await router.runWithFailover({
      task: "reasoning",
      run: async (model) => {
        calls += 1;
        if (model.id.includes("model-a")) {
          const err = new Error("timeout");
          (err as Error & { status?: number }).status = 529;
          throw err;
        }
        return model.id;
      },
    });

    expect(result).toContain("model-b");
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("tracks history and exposes it in status --history", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sp8-router-"));
    const router = new Sp8Router({
      stateDir,
      nowMs: () => 2_000,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "acme/reasoner:free", pricing: { prompt: "0", completion: "0" } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    await router.runWithFailover({
      task: "reasoning",
      run: async (model) => model.id,
    });

    const status = router.getStatus({ history: true });
    expect(Array.isArray(status.history)).toBe(true);
    expect(status.history?.[0]?.id).toContain("acme/reasoner:free");
    expect(status.history?.[0]?.successRate).toBe(1);

    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("blacklists model after repeated retriable failures", async () => {
    let now = 10_000;
    const router = new Sp8Router({
      nowMs: () => now,
      persistHealth: false,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "acme/model-a:free", pricing: { prompt: "0", completion: "0" } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    const timeoutError = new Error("timeout") as Error & { status?: number };
    timeoutError.status = 529;

    for (let idx = 0; idx < 3; idx += 1) {
      await expect(
        router.runWithFailover({
          task: "reasoning",
          maxAttempts: 1,
          run: async () => {
            now += 50;
            throw timeoutError;
          },
        }),
      ).rejects.toThrow(/timeout/i);
      now += 50;
    }

    await expect(
      router.runWithFailover({
        task: "reasoning",
        maxAttempts: 1,
        run: async () => "ok",
      }),
    ).rejects.toThrow(/temporarily blacklisted/i);
  });
});
