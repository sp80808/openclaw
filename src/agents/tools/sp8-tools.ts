import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { runGeminiCliPrompt } from "../../sp8/gemini/cli.js";
import { runParallelMultimodal } from "../../sp8/router/parallel-fusion.js";
import { Sp8Router } from "../../sp8/router/sp8-router.js";
import { createSp8Swarm } from "../../sp8/swarm.js";
import { resolveUserPath } from "../../utils.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const router = new Sp8Router();

export function createAntigravityPhysicsTool(): AnyAgentTool {
  return {
    name: "antigravity-physics",
    label: "Antigravity Physics",
    description: "Generate floating idea graph data for Live Canvas physics layouts.",
    parameters: Type.Object({
      ideas: Type.Array(Type.String(), { minItems: 1 }),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as { ideas?: string[] };
      const ideas = Array.isArray(params.ideas) ? params.ideas.filter(Boolean) : [];
      const nodes = ideas.map((idea, idx) => ({
        id: `idea-${idx + 1}`,
        label: idea,
        mass: 1 + (idx % 3),
      }));
      const links = nodes.slice(1).map((node, idx) => ({
        from: nodes[idx].id,
        to: node.id,
        strength: 0.6,
      }));
      return jsonResult({ nodes, links, gravity: -0.08 });
    },
  };
}

export function createSelfEvolveTool(): AnyAgentTool {
  return {
    name: "self-evolve",
    label: "Self Evolve",
    description: "Record reinforcement feedback signals for local self-improvement loops.",
    parameters: Type.Object({
      signal: Type.String(),
      delta: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const signal = readStringParam(params, "signal", { required: true });
      const delta =
        typeof params.delta === "number" && Number.isFinite(params.delta) ? params.delta : 1;
      const file = path.join(resolveUserPath("~/.openclaw/sp8"), "self-evolve.jsonl");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(
        file,
        `${JSON.stringify({ at: new Date().toISOString(), signal, delta })}\n`,
      );
      return jsonResult({ ok: true, signal, delta });
    },
  };
}

export function createSwarmCommanderTool(): AnyAgentTool {
  return {
    name: "swarm-commander",
    label: "Swarm Commander",
    description: "Create an 8-agent specialist swarm plan for a goal.",
    parameters: Type.Object({
      goal: Type.String(),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const goal = readStringParam(params, "goal", { required: true });
      return jsonResult(createSp8Swarm(goal));
    },
  };
}

export function createParallelMultimodalExecutorTool(): AnyAgentTool {
  return {
    name: "parallel-multimodal-executor",
    label: "Parallel Multimodal Executor",
    description: "Run free-model multimodal fanout and fuse consensus output.",
    parameters: Type.Object({
      prompt: Type.String(),
      task: Type.Optional(Type.String()),
      fanout: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const taskRaw = readStringParam(params, "task") ?? "reasoning";
      const task = taskRaw === "vision" || taskRaw === "speed" ? taskRaw : "reasoning";
      const fanoutRaw = typeof params.fanout === "number" ? params.fanout : 3;
      const fanout = fanoutRaw >= 4 ? 4 : fanoutRaw <= 2 ? 2 : 3;

      await router.initialize();
      const result = await runParallelMultimodal({
        router,
        task,
        prompt,
        fanout,
        runOpenRouter: async (modelId, message) => `OpenRouter ${modelId}: ${message}`,
        runGeminiCli: async (message) => {
          try {
            return await runGeminiCliPrompt(message);
          } catch {
            return `Gemini CLI unavailable: ${message}`;
          }
        },
      });

      return jsonResult(result);
    },
  };
}

export function createPersonalKgTool(): AnyAgentTool {
  return {
    name: "personal-kg",
    label: "Personal KG",
    description:
      "Append/query local personal knowledge graph entries (LanceDB-compatible JSONL seed).",
    parameters: Type.Object({
      action: Type.String(),
      key: Type.Optional(Type.String()),
      value: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const file = path.join(resolveUserPath("~/.openclaw/sp8"), "personal-kg.jsonl");
      await fs.mkdir(path.dirname(file), { recursive: true });

      if (action === "put") {
        const key = readStringParam(params, "key", { required: true });
        const value = readStringParam(params, "value", { required: true });
        await fs.appendFile(file, `${JSON.stringify({ key, value, at: Date.now() })}\n`);
        return jsonResult({ ok: true, key });
      }

      const key = readStringParam(params, "key", { required: action === "get" });
      const raw = await fs.readFile(file, "utf8").catch(() => "");
      const rows = raw
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { key: string; value: string; at: number });
      if (action === "get" && key) {
        return jsonResult({
          entries: rows.filter((row) => row.key === key),
        });
      }
      return jsonResult({ entries: rows.slice(-50) });
    },
  };
}

export function createAntigravityEasterEggTool(): AnyAgentTool {
  return {
    name: "antigravity-easter-egg",
    label: "Antigravity Easter Egg",
    description: "Return xkcd antigravity comic reference and zero-gravity mini-game seed state.",
    parameters: Type.Object({
      seed: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const seed = readStringParam(params, "seed") ?? "sp8-zero-g";
      return jsonResult({
        comic: "https://xkcd.com/353/",
        game: {
          seed,
          gravity: -0.05,
          objective: "Collect 8 tentacles and dock with the lobster claw core.",
        },
      });
    },
  };
}
