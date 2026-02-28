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
});
