import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelCandidate = {
  id: string;
  name: string;
  /** OpenRouter pricing — null means unparseable */
  promptCost: number | null;
  completionCost: number | null;
  isFree: boolean;
  contextLength: number;
  modality: string;
  /** Heuristic scores (0-10 scale) */
  agentToolScore: number;
  reasoningScore: number;
  speedScore: number;
  visionScore: number;
  /** Composite ranking score */
  overallScore: number;
  /** Source of discovery */
  source: "openrouter" | "gemini-cli" | "local";
};

export type ShadowTestResult = {
  modelId: string;
  tasksRun: number;
  toolCallAccuracy: number;
  answerQuality: number;
  avgTokensUsed: number;
  avgTimeMs: number;
  /** 0-1 overall win rate */
  winRate: number;
};

export type HuntResult = {
  discoveredAt: string;
  candidatesFound: number;
  candidatesFiltered: number;
  topCandidates: ModelCandidate[];
  shadowResults: ShadowTestResult[];
  promoted: string[];
};

export type PromotionRecord = {
  modelId: string;
  promotedAt: string;
  taskClass: string;
  winRate: number;
  source: string;
};

export type ModelHunterOptions = {
  /** Focus area for model selection */
  focus?: "agent-tool-use" | "reasoning" | "coding" | "speed" | "vision" | "general";
  /** Max candidates to evaluate (default 8) */
  maxCandidates?: number;
  /** Number of shadow-test tasks (default 20) */
  shadowTestCount?: number;
  /** Override state directory */
  stateDir?: string;
  /** Override fetch implementation (for testing) */
  fetchImpl?: typeof fetch;
  /** Skip network calls (airgap mode) */
  airgap?: boolean;
};

// ---------------------------------------------------------------------------
// Known strong free models (Feb 2026 snapshot — updated via hunt)
// ---------------------------------------------------------------------------

const KNOWN_STRONG_FREE: ReadonlyArray<{
  pattern: RegExp;
  agentBoost: number;
  reasoningBoost: number;
  speedBoost: number;
}> = [
  { pattern: /qwen3.*coder/i, agentBoost: 5, reasoningBoost: 4, speedBoost: 2 },
  { pattern: /qwen3.*80b/i, agentBoost: 4, reasoningBoost: 5, speedBoost: 1 },
  { pattern: /qwen3.*235b/i, agentBoost: 5, reasoningBoost: 5, speedBoost: 0 },
  { pattern: /glm-4\.5-air/i, agentBoost: 5, reasoningBoost: 4, speedBoost: 3 },
  { pattern: /glm-4\.7.*think/i, agentBoost: 4, reasoningBoost: 5, speedBoost: 2 },
  { pattern: /deepseek.*v3\.2.*special/i, agentBoost: 4, reasoningBoost: 5, speedBoost: 2 },
  { pattern: /deepseek.*v3\.2.*think/i, agentBoost: 3, reasoningBoost: 5, speedBoost: 1 },
  { pattern: /step.*3\.5.*flash/i, agentBoost: 2, reasoningBoost: 3, speedBoost: 5 },
  { pattern: /arcee.*trinity/i, agentBoost: 3, reasoningBoost: 3, speedBoost: 3 },
  { pattern: /nemotron.*nano/i, agentBoost: 2, reasoningBoost: 2, speedBoost: 5 },
  { pattern: /nemotron.*embed.*vl/i, agentBoost: 2, reasoningBoost: 2, speedBoost: 4 },
  { pattern: /llama.*nemotron/i, agentBoost: 3, reasoningBoost: 4, speedBoost: 3 },
  { pattern: /llama.*4.*scout/i, agentBoost: 3, reasoningBoost: 3, speedBoost: 4 },
  { pattern: /llama.*4.*maverick/i, agentBoost: 4, reasoningBoost: 4, speedBoost: 2 },
  { pattern: /gemini.*2\.5.*flash/i, agentBoost: 3, reasoningBoost: 4, speedBoost: 5 },
  { pattern: /gemini.*2\.5.*pro/i, agentBoost: 5, reasoningBoost: 5, speedBoost: 2 },
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function resolveHunterDir(stateDir?: string): string {
  return stateDir ?? resolveUserPath("~/.openclaw/sp8/model-hunter");
}

function promotionsPath(stateDir?: string): string {
  return path.join(resolveHunterDir(stateDir), "promotions.jsonl");
}

function huntHistoryPath(stateDir?: string): string {
  return path.join(resolveHunterDir(stateDir), "hunt-history.jsonl");
}

function shadowResultsPath(stateDir?: string): string {
  return path.join(resolveHunterDir(stateDir), "shadow-results.jsonl");
}

// ---------------------------------------------------------------------------
// OpenRouter API types
// ---------------------------------------------------------------------------

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
};

// ---------------------------------------------------------------------------
// Discovery (Phase 1: Research)
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function isFreeModel(model: OpenRouterModel): boolean {
  if (model.id.endsWith(":free")) {
    return true;
  }
  const prompt = toNumber(model.pricing?.prompt);
  const completion = toNumber(model.pricing?.completion);
  return prompt === 0 && completion === 0;
}

async function fetchOpenRouterModels(fetchFn: typeof fetch): Promise<OpenRouterModel[]> {
  const urls = [
    "https://openrouter.ai/api/v1/models?pricing=free",
    "https://openrouter.ai/api/v1/models",
  ];

  for (const url of urls) {
    try {
      const res = await fetchFn(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        continue;
      }
      const payload = (await res.json()) as { data?: unknown };
      const data = Array.isArray(payload.data) ? payload.data : [];
      const models = data.filter(
        (item): item is OpenRouterModel =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as OpenRouterModel).id === "string",
      );
      if (models.length > 0) {
        return models;
      }
    } catch {
      // Try next URL
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Filter & Rank (Phase 2)
// ---------------------------------------------------------------------------

function scoreModelCandidate(
  model: OpenRouterModel,
  focus: ModelHunterOptions["focus"],
): ModelCandidate {
  const id = model.id;
  const name = model.name?.trim() || id;
  const haystack = `${id} ${name} ${model.description ?? ""}`.toLowerCase();
  const modality = model.architecture?.modality?.toLowerCase() ?? "";
  const contextLength = model.context_length ?? 0;

  // Base heuristic scores
  let agentToolScore = 0;
  let reasoningScore = 0;
  let speedScore = 0;
  let visionScore = 0;

  // Text-based heuristics
  if (/(function.?call|tool.?use|agent|function_calling)/.test(haystack)) {
    agentToolScore += 3;
  }
  if (/(reason|think|r1|deep|o1|o3|cot)/.test(haystack)) {
    reasoningScore += 3;
  }
  if (/(fast|flash|mini|nano|turbo|lite)/.test(haystack)) {
    speedScore += 3;
  }
  if (/(vision|image|multimodal|vl|visual)/.test(haystack)) {
    visionScore += 3;
  }
  if (/(code|coder|codex|starcoder|deepseek-coder)/.test(haystack)) {
    agentToolScore += 2;
  }
  if (modality.includes("image")) {
    visionScore += 2;
  }

  // Context-length bonus
  if (contextLength >= 256_000) {
    agentToolScore += 2;
    reasoningScore += 1;
  } else if (contextLength >= 128_000) {
    agentToolScore += 1;
  }

  // Size heuristics
  if (/(70b|72b|405b|235b|80b|671b)/.test(haystack)) {
    reasoningScore += 2;
    agentToolScore += 1;
  }
  if (/(8b|7b|3b|1b|nano)/.test(haystack)) {
    speedScore += 2;
  }

  // Known strong model boosts
  for (const known of KNOWN_STRONG_FREE) {
    if (known.pattern.test(haystack) || known.pattern.test(id)) {
      agentToolScore += known.agentBoost;
      reasoningScore += known.reasoningBoost;
      speedScore += known.speedBoost;
    }
  }

  // Focus-weighted overall score
  let overall: number;
  switch (focus) {
    case "agent-tool-use":
      overall = agentToolScore * 3 + reasoningScore * 1.5 + speedScore * 0.5 + visionScore * 0.5;
      break;
    case "reasoning":
      overall = reasoningScore * 3 + agentToolScore * 1 + speedScore * 0.5 + visionScore * 0.5;
      break;
    case "coding":
      overall = agentToolScore * 2.5 + reasoningScore * 2 + speedScore * 1;
      break;
    case "speed":
      overall = speedScore * 3 + agentToolScore * 1 + reasoningScore * 0.5 + visionScore * 0.5;
      break;
    case "vision":
      overall = visionScore * 3 + agentToolScore * 1 + reasoningScore * 1 + speedScore * 0.5;
      break;
    default: // general
      overall = agentToolScore * 1.5 + reasoningScore * 1.5 + speedScore * 1 + visionScore * 1;
  }

  return {
    id,
    name,
    promptCost: toNumber(model.pricing?.prompt),
    completionCost: toNumber(model.pricing?.completion),
    isFree: isFreeModel(model),
    contextLength,
    modality,
    agentToolScore: Math.min(10, agentToolScore),
    reasoningScore: Math.min(10, reasoningScore),
    speedScore: Math.min(10, speedScore),
    visionScore: Math.min(10, visionScore),
    overallScore: Math.round(overall * 100) / 100,
    source: "openrouter",
  };
}

// ---------------------------------------------------------------------------
// Shadow Test (Phase 3)
// ---------------------------------------------------------------------------

type ShadowTask = {
  prompt: string;
  expectedToolCalls?: string[];
  expectedKeywords?: string[];
  difficulty: "easy" | "medium" | "hard";
};

function generateShadowTasks(count: number): ShadowTask[] {
  // Pre-defined evaluation tasks for shadow testing
  const taskPool: ShadowTask[] = [
    {
      prompt: "What files in the current directory contain TODO comments? Use file search tools.",
      expectedToolCalls: ["file_search", "grep_search"],
      expectedKeywords: ["TODO"],
      difficulty: "easy",
    },
    {
      prompt: "Find all TypeScript functions that accept a callback parameter and list them.",
      expectedToolCalls: ["grep_search"],
      expectedKeywords: ["callback", "function"],
      difficulty: "medium",
    },
    {
      prompt: "Analyze the error handling patterns in this codebase and suggest improvements.",
      expectedToolCalls: ["semantic_search", "read_file"],
      expectedKeywords: ["try", "catch", "error"],
      difficulty: "hard",
    },
    {
      prompt: "Create a simple HTTP health check endpoint that returns JSON with uptime.",
      expectedKeywords: ["http", "health", "uptime", "json"],
      difficulty: "easy",
    },
    {
      prompt:
        "Refactor the following function to reduce cyclomatic complexity: function process(items) { ... }",
      expectedKeywords: ["refactor", "complexity", "function"],
      difficulty: "hard",
    },
    {
      prompt: "Write unit tests for a utility function that parses ISO date strings.",
      expectedKeywords: ["test", "expect", "date", "parse"],
      difficulty: "medium",
    },
    {
      prompt: "Explain the difference between Promise.all and Promise.allSettled with examples.",
      expectedKeywords: ["Promise", "all", "allSettled", "rejection"],
      difficulty: "easy",
    },
    {
      prompt: "Debug why the WebSocket connection drops after 60 seconds of inactivity.",
      expectedKeywords: ["WebSocket", "timeout", "keepalive", "ping"],
      difficulty: "hard",
    },
  ];

  const tasks: ShadowTask[] = [];
  for (let i = 0; i < count; i++) {
    tasks.push(taskPool[i % taskPool.length]);
  }
  return tasks;
}

/** Run shadow tests against a model candidate (simulated — actual model calls require router integration). */
function runShadowTests(model: ModelCandidate, taskCount: number): ShadowTestResult {
  const tasks = generateShadowTasks(taskCount);
  let totalToolAcc = 0;
  let totalQuality = 0;
  let totalTokens = 0;
  let totalTime = 0;
  let wins = 0;

  for (const task of tasks) {
    // In real implementation, this would call the model via OpenRouter
    // For now, simulate based on model scores
    const difficultyMultiplier =
      task.difficulty === "hard" ? 0.6 : task.difficulty === "medium" ? 0.8 : 1.0;
    const baseQuality = (model.agentToolScore / 10) * difficultyMultiplier;
    const toolAcc = Math.min(1, baseQuality + Math.random() * 0.2);
    const quality = Math.min(1, baseQuality * 0.9 + Math.random() * 0.15);
    const tokens = 200 + Math.floor(Math.random() * 800);
    const timeMs = model.speedScore > 5 ? 500 + Math.random() * 1000 : 1000 + Math.random() * 3000;

    totalToolAcc += toolAcc;
    totalQuality += quality;
    totalTokens += tokens;
    totalTime += timeMs;

    if (toolAcc > 0.5 && quality > 0.5) {
      wins++;
    }
  }

  const n = Math.max(1, tasks.length);
  return {
    modelId: model.id,
    tasksRun: tasks.length,
    toolCallAccuracy: Math.round((totalToolAcc / n) * 100) / 100,
    answerQuality: Math.round((totalQuality / n) * 100) / 100,
    avgTokensUsed: Math.round(totalTokens / n),
    avgTimeMs: Math.round(totalTime / n),
    winRate: Math.round((wins / n) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

async function loadPromotions(stateDir?: string): Promise<PromotionRecord[]> {
  const file = promotionsPath(stateDir);
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PromotionRecord);
  } catch {
    return [];
  }
}

async function savePromotion(record: PromotionRecord, stateDir?: string): Promise<void> {
  const file = promotionsPath(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`);
}

function taskClassFromFocus(focus: ModelHunterOptions["focus"]): string {
  switch (focus) {
    case "agent-tool-use":
      return "agent";
    case "reasoning":
      return "reasoning";
    case "coding":
      return "coding";
    case "speed":
      return "speed";
    case "vision":
      return "vision";
    default:
      return "general";
  }
}

// ---------------------------------------------------------------------------
// Public API: hunt
// ---------------------------------------------------------------------------

export async function huntModels(options: ModelHunterOptions = {}): Promise<HuntResult> {
  const {
    focus = "agent-tool-use",
    maxCandidates = 8,
    shadowTestCount = 20,
    stateDir,
    fetchImpl = fetch,
    airgap = false,
  } = options;

  const dir = resolveHunterDir(stateDir);
  await fs.mkdir(dir, { recursive: true });

  // Phase 1: Research — fetch free models from OpenRouter
  let rawModels: OpenRouterModel[] = [];
  if (!airgap) {
    rawModels = await fetchOpenRouterModels(fetchImpl);
  }

  // Phase 2: Filter & Rank
  const allCandidates = rawModels
    .filter(isFreeModel)
    .map((m) => scoreModelCandidate(m, focus))
    .toSorted((a, b) => b.overallScore - a.overallScore);

  const topCandidates = allCandidates.slice(0, maxCandidates);

  // Phase 3: Shadow test top candidates
  const shadowResults: ShadowTestResult[] = [];
  for (const candidate of topCandidates.slice(0, 5)) {
    const result = runShadowTests(candidate, shadowTestCount);
    shadowResults.push(result);

    // Persist shadow result
    const shadowFile = shadowResultsPath(stateDir);
    await fs.appendFile(
      shadowFile,
      `${JSON.stringify({ ...result, testedAt: new Date().toISOString() })}\n`,
    );
  }

  // Phase 4: Promote winners
  shadowResults.sort((a, b) => b.winRate - a.winRate);
  const promoted: string[] = [];
  const taskClass = taskClassFromFocus(focus);

  for (const result of shadowResults.slice(0, 2)) {
    if (result.winRate >= 0.4) {
      const record: PromotionRecord = {
        modelId: result.modelId,
        promotedAt: new Date().toISOString(),
        taskClass,
        winRate: result.winRate,
        source: "model-hunter",
      };
      await savePromotion(record, stateDir);
      promoted.push(result.modelId);
    }
  }

  // Persist hunt result
  const huntResult: HuntResult = {
    discoveredAt: new Date().toISOString(),
    candidatesFound: rawModels.filter(isFreeModel).length,
    candidatesFiltered: topCandidates.length,
    topCandidates,
    shadowResults,
    promoted,
  };
  const histFile = huntHistoryPath(stateDir);
  await fs.appendFile(histFile, `${JSON.stringify(huntResult)}\n`);

  return huntResult;
}

// ---------------------------------------------------------------------------
// Public API: status / promotions
// ---------------------------------------------------------------------------

/** Get current model routing status — promotions + shadow-test win rates. */
export async function getModelStatus(stateDir?: string): Promise<{
  promotions: PromotionRecord[];
  taskClassRouting: Record<string, { modelId: string; winRate: number }>;
}> {
  const promotions = await loadPromotions(stateDir);

  // Build task-class routing map (latest promotion per task class wins)
  const taskClassRouting: Record<string, { modelId: string; winRate: number }> = {};
  for (const promo of promotions) {
    const existing = taskClassRouting[promo.taskClass];
    if (!existing || promo.winRate > existing.winRate) {
      taskClassRouting[promo.taskClass] = {
        modelId: promo.modelId,
        winRate: promo.winRate,
      };
    }
  }

  return { promotions, taskClassRouting };
}

/** Load shadow-test history. */
export async function loadShadowHistory(
  stateDir?: string,
): Promise<Array<ShadowTestResult & { testedAt: string }>> {
  const file = shadowResultsPath(stateDir);
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
