/**
 * Core types for the Sp8 lightweight self-benchmarking system.
 *
 * Design goals:
 * - < 100 MB persistent storage after months of use
 * - Near-zero overhead in the critical inference path
 * - Local-first, no external dependencies for eval
 */

/** Task classes for stratified routing. Kept small for bandit convergence. */
export type Sp8TaskClass = "coding" | "planning" | "browser" | "device" | "chat";

export const ALL_TASK_CLASSES: readonly Sp8TaskClass[] = [
  "coding",
  "planning",
  "browser",
  "device",
  "chat",
] as const;

/** Per-model, per-task-class statistics for bandit arms. */
export type Sp8ModelStats = {
  /** Thompson sampling alpha (successes). Starts at 1 for uniform prior. */
  alpha: number;
  /** Thompson sampling beta (failures). Starts at 1 for uniform prior. */
  beta: number;
  /** Total requests routed to this arm. */
  pulls: number;
  /** Cumulative weighted reward ∈ [0,1]. */
  wins: number;
  /** Total tokens consumed (prompt + completion). */
  tokensUsed: number;
  /** Running average latency in ms. */
  avgLatencyMs: number;
  /** Last N scores for trend detection. */
  recentScores: number[];
};

/** A single tool call recorded in a trajectory. */
export type Sp8ToolCall = {
  name: string;
  durationMs: number;
  success: boolean;
};

/** Lightweight trajectory record stored in the ring buffer. */
export type Sp8Trajectory = {
  /** Non-reversible hash of the query for privacy. */
  queryHash: number;
  /** Model id used for this request. */
  modelUsed: string;
  /** Classified task type. */
  taskClass: Sp8TaskClass;
  /** Tool calls made during execution. */
  toolsCalled: Sp8ToolCall[];
  /** Judge score ∈ [0, 1]. 0 = not yet scored. */
  judgeScore: number;
  /** Cheap success proxy ∈ {0, 0.5, 1}. */
  successProxy: number;
  /** Optional user thumbs signal. */
  userThumbs: boolean | null;
  /** Unix epoch ms. */
  timestamp: number;
  /** Total tokens used in this request. */
  tokens: number;
  /** E2E latency ms. */
  latencyMs: number;
};

/** Composite score combining judge + proxy. */
export type Sp8CompositeScore = {
  judgeScore: number;
  successProxy: number;
  composite: number;
};

/** Judge output schema — what the tiny LLM returns. */
export type Sp8JudgeOutput = {
  toolSelectionCorrect: number;
  toolExecutionQuality: number;
  reasoningCoherence: number;
  finalAnswerHelpfulness: number;
  overallSuccessProb: number;
};

/** Serialized benchmark state for persistence. */
export type Sp8BenchState = {
  version: 2;
  updatedAt: string;
  /** modelId -> taskClass -> ModelStats */
  arms: Record<string, Record<string, Sp8ModelStats>>;
  /** Ring buffer of recent trajectories. */
  trajectories: Sp8Trajectory[];
  /** Pointer into the ring buffer. */
  trajectoryHead: number;
  /** Total requests processed since creation. */
  totalRequests: number;
  /** Nightly evolution run counter. */
  evolutionRuns: number;
};

/** Configuration for the benchmark engine. */
export type Sp8BenchConfig = {
  /** Maximum trajectory ring buffer size. Default: 400. */
  maxTrajectories: number;
  /** Size of the recent scores window per arm. Default: 20. */
  recentScoresWindow: number;
  /** Weight of judge score in composite. Default: 0.7. */
  judgeWeight: number;
  /** Weight of success proxy in composite. Default: 0.3. */
  proxyWeight: number;
  /** Minimum pulls before arm is eligible for demotion. Default: 5. */
  minPullsForDemotion: number;
  /** Number of trajectories to sample for nightly evolution. Default: 20. */
  nightlySampleSize: number;
  /** Number of prompt variants to test in evolution. Default: 3. */
  evolutionVariants: number;
  /** Trigger nightly evolution every N requests. Default: 50. */
  evolutionTriggerInterval: number;
  /** Local judge endpoint (Ollama-compatible). */
  judgeEndpoint: string;
  /** Local judge model name. Default: "phi4-mini". */
  judgeModel: string;
  /** Whether to enable the judge at all. Default: false (v0.1 starts without). */
  judgeEnabled: boolean;
};

export const DEFAULT_BENCH_CONFIG: Sp8BenchConfig = {
  maxTrajectories: 400,
  recentScoresWindow: 20,
  judgeWeight: 0.7,
  proxyWeight: 0.3,
  minPullsForDemotion: 5,
  nightlySampleSize: 20,
  evolutionVariants: 3,
  evolutionTriggerInterval: 50,
  judgeEndpoint: "http://localhost:11434",
  judgeModel: "phi4-mini",
  judgeEnabled: false,
};
