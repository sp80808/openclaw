import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskClass =
  | "coding"
  | "reasoning"
  | "planning"
  | "agent"
  | "vision"
  | "speed"
  | "general";

export type FallbackEvent = {
  at: string;
  modelId: string;
  reason: "429" | "timeout" | "error" | "circuit-breaker";
  consecutiveCount: number;
};

export type RouteDecision = {
  taskClass: TaskClass;
  primaryModel: string;
  fallbackChain: string[];
  confidence: number;
  reason: string;
};

export type SafetyConfig = {
  /** Max consecutive 429s before auto-downgrade (default 3) */
  maxConsecutive429s: number;
  /** Whether to auto-apply evolve patches (default false — user veto) */
  autoApplyEvolve: boolean;
  /** Whether to auto-promote models from shadow tests (default false) */
  autoPromoteModels: boolean;
  /** Cooldown period after fallback in ms (default 30min) */
  fallbackCooldownMs: number;
  /** Notify user on big changes (default true) */
  notifyOnChanges: boolean;
};

export type MetricsSnapshot = {
  generatedAt: string;
  taskClassWinRates: Record<string, { modelId: string; winRate: number; sampleSize: number }>;
  fallbackEvents: FallbackEvent[];
  recentDecisions: RouteDecision[];
  health: {
    totalModelsTracked: number;
    modelsOnCooldown: number;
    avgSuccessRate: number;
  };
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function resolveRailsDir(stateDir?: string): string {
  return stateDir ?? resolveUserPath("~/.openclaw/sp8/rails");
}

function fallbackLogPath(stateDir?: string): string {
  return path.join(resolveRailsDir(stateDir), "fallback-events.jsonl");
}

function decisionsLogPath(stateDir?: string): string {
  return path.join(resolveRailsDir(stateDir), "decisions.jsonl");
}

function safetyConfigPath(stateDir?: string): string {
  return path.join(resolveRailsDir(stateDir), "safety.json");
}

// ---------------------------------------------------------------------------
// Safety config
// ---------------------------------------------------------------------------

const DEFAULT_SAFETY: SafetyConfig = {
  maxConsecutive429s: 3,
  autoApplyEvolve: false,
  autoPromoteModels: false,
  fallbackCooldownMs: 30 * 60 * 1000,
  notifyOnChanges: true,
};

export async function loadSafetyConfig(stateDir?: string): Promise<SafetyConfig> {
  const file = safetyConfigPath(stateDir);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<SafetyConfig>;
    return { ...DEFAULT_SAFETY, ...parsed };
  } catch {
    return { ...DEFAULT_SAFETY };
  }
}

export async function saveSafetyConfig(
  config: Partial<SafetyConfig>,
  stateDir?: string,
): Promise<SafetyConfig> {
  const file = safetyConfigPath(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const current = await loadSafetyConfig(stateDir);
  const merged = { ...current, ...config };
  await fs.writeFile(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

// ---------------------------------------------------------------------------
// Task-class routing awareness
// ---------------------------------------------------------------------------

type PromotionEntry = {
  modelId: string;
  taskClass: string;
  winRate: number;
};

async function loadPromotions(stateDir?: string): Promise<PromotionEntry[]> {
  const file = path.join(
    stateDir ?? resolveUserPath("~/.openclaw/sp8/model-hunter"),
    "promotions.jsonl",
  );
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PromotionEntry);
  } catch {
    return [];
  }
}

/**
 * Classify a task into a task class based on content heuristics.
 * Used to route to the best-performing model for that class.
 */
export function classifyTask(taskText: string): TaskClass {
  const lower = taskText.toLowerCase();

  if (
    /(write code|implement|refactor|fix bug|debug|typescript|python|function|class |import )/.test(
      lower,
    )
  ) {
    return "coding";
  }
  if (/(reason|think step|analyze|compare|evaluate|proof|logic|math|calculate)/.test(lower)) {
    return "reasoning";
  }
  if (/(plan|roadmap|strategy|break down|decompose|outline|steps to)/.test(lower)) {
    return "planning";
  }
  if (/(image|screenshot|photo|visual|picture|diagram|chart)/.test(lower)) {
    return "vision";
  }
  if (/(quick|fast|short answer|one.?line|tl;?dr|brief)/.test(lower)) {
    return "speed";
  }
  if (/(tool|search|browse|file|terminal|execute|run command|api call)/.test(lower)) {
    return "agent";
  }
  return "general";
}

/**
 * Route a task to the best model based on promotions and fallback chain.
 */
export async function routeTask(
  taskText: string,
  availableModels: string[],
  stateDir?: string,
): Promise<RouteDecision> {
  const taskClass = classifyTask(taskText);
  const promotions = await loadPromotions(stateDir);

  // Find best promoted model for this task class
  const classPromotions = promotions
    .filter((p) => p.taskClass === taskClass || p.taskClass === "general")
    .toSorted((a, b) => b.winRate - a.winRate);

  let primaryModel: string;
  let confidence: number;
  let reason: string;

  if (classPromotions.length > 0) {
    const best = classPromotions[0];
    if (availableModels.includes(best.modelId)) {
      primaryModel = best.modelId;
      confidence = best.winRate;
      reason = `Promoted model for ${taskClass} (${Math.round(best.winRate * 100)}% win rate)`;
    } else {
      // Promoted model not available — fallback to first available
      primaryModel = availableModels[0] ?? "unknown";
      confidence = 0.3;
      reason = `Promoted model ${best.modelId} unavailable, using fallback`;
    }
  } else {
    primaryModel = availableModels[0] ?? "unknown";
    confidence = 0.2;
    reason = `No promotion data for ${taskClass}, using default`;
  }

  // Build fallback chain from available models (excluding primary)
  const fallbackChain = availableModels.filter((m) => m !== primaryModel).slice(0, 3);

  return {
    taskClass,
    primaryModel,
    fallbackChain,
    confidence,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Fallback chain hardening
// ---------------------------------------------------------------------------

export async function recordFallbackEvent(
  event: FallbackEvent,
  stateDir?: string,
): Promise<{ shouldNotify: boolean; message: string }> {
  const dir = resolveRailsDir(stateDir);
  await fs.mkdir(dir, { recursive: true });
  const file = fallbackLogPath(stateDir);
  await fs.appendFile(file, `${JSON.stringify(event)}\n`);

  const config = await loadSafetyConfig(stateDir);
  const shouldNotify =
    config.notifyOnChanges && event.consecutiveCount >= config.maxConsecutive429s;
  const message = shouldNotify
    ? `Model ${event.modelId} hit ${event.consecutiveCount} consecutive ${event.reason}s — auto-downgraded. Run 'sp8 models status' for details.`
    : "";

  return { shouldNotify, message };
}

async function loadFallbackEvents(stateDir?: string): Promise<FallbackEvent[]> {
  const file = fallbackLogPath(stateDir);
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FallbackEvent);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route decision logging
// ---------------------------------------------------------------------------

export async function logRouteDecision(decision: RouteDecision, stateDir?: string): Promise<void> {
  const dir = resolveRailsDir(stateDir);
  await fs.mkdir(dir, { recursive: true });
  const file = decisionsLogPath(stateDir);
  await fs.appendFile(file, `${JSON.stringify({ ...decision, at: new Date().toISOString() })}\n`);
}

// ---------------------------------------------------------------------------
// Metrics dashboard
// ---------------------------------------------------------------------------

export async function generateMetrics(stateDir?: string): Promise<MetricsSnapshot> {
  const promotions = await loadPromotions(stateDir);
  const fallbackEvents = await loadFallbackEvents(stateDir);

  // Task-class win rates from promotions
  const taskClassWinRates: Record<
    string,
    { modelId: string; winRate: number; sampleSize: number }
  > = {};
  const taskCounts: Record<string, number> = {};

  for (const promo of promotions) {
    taskCounts[promo.taskClass] = (taskCounts[promo.taskClass] ?? 0) + 1;
    const existing = taskClassWinRates[promo.taskClass];
    if (!existing || promo.winRate > existing.winRate) {
      taskClassWinRates[promo.taskClass] = {
        modelId: promo.modelId,
        winRate: promo.winRate,
        sampleSize: taskCounts[promo.taskClass],
      };
    }
  }

  // Recent decisions
  const decisionsFile = decisionsLogPath(stateDir);
  let recentDecisions: RouteDecision[] = [];
  try {
    const raw = await fs.readFile(decisionsFile, "utf8");
    recentDecisions = raw
      .split(/\n+/)
      .filter(Boolean)
      .slice(-10)
      .map((line) => JSON.parse(line) as RouteDecision);
  } catch {
    // No decisions yet
  }

  // Unique models tracked
  const uniqueModels = new Set(promotions.map((p) => p.modelId));
  const modelsOnCooldown = fallbackEvents
    .filter((e) => {
      const eventTime = new Date(e.at).getTime();
      return Date.now() - eventTime < 30 * 60 * 1000 && e.consecutiveCount >= 3;
    })
    .map((e) => e.modelId);
  const uniqueCooldown = new Set(modelsOnCooldown);

  const avgWinRate =
    promotions.length > 0 ? promotions.reduce((s, p) => s + p.winRate, 0) / promotions.length : 0;

  return {
    generatedAt: new Date().toISOString(),
    taskClassWinRates,
    fallbackEvents: fallbackEvents.slice(-20),
    recentDecisions,
    health: {
      totalModelsTracked: uniqueModels.size,
      modelsOnCooldown: uniqueCooldown.size,
      avgSuccessRate: Math.round(avgWinRate * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// ASCII win-rate-over-time chart
// ---------------------------------------------------------------------------

export function renderWinRateChart(
  dataPoints: Array<{ label: string; value: number }>,
  width = 50,
): string {
  if (dataPoints.length === 0) {
    return "No data available.";
  }

  const maxVal = Math.max(...dataPoints.map((d) => d.value), 0.01);
  const lines: string[] = ["Win Rate Over Time", "═".repeat(width + 14)];

  for (const point of dataPoints) {
    const barLen = Math.round((point.value / maxVal) * width);
    const bar = "█".repeat(barLen) + "░".repeat(width - barLen);
    const pct = `${Math.round(point.value * 100)}%`.padStart(4);
    lines.push(`${point.label.padEnd(12)} ${bar} ${pct}`);
  }

  lines.push("═".repeat(width + 14));
  return lines.join("\n");
}
