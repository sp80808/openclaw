/**
 * Sp8 Benchmark Engine — main orchestrator for the self-benchmarking system.
 *
 * Two intertwined feedback loops:
 *
 * Loop A (per-request, almost free):
 *   After every agent response → judge + proxy → bandit update
 *
 * Loop B (periodic mini-evolution):
 *   Every N requests → sample trajectories → aggregate → promote/demote
 *
 * Persistence: single JSON file < 100 MB even after months.
 * Critical path overhead: ~1–3% extra tokens (judge prompt when enabled).
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  armMean,
  createArm,
  demoteArm,
  isDegrading,
  promoteArm,
  selectArms,
  updateArm,
} from "./bandit.js";
import { heuristicScore, runJudge } from "./judge.js";
import { RingBuffer } from "./ring-buffer.js";
import {
  classifyTaskClass,
  compositeScore,
  computeSuccessProxy,
  hashQuery,
} from "./success-proxy.js";
import type {
  Sp8BenchConfig,
  Sp8BenchState,
  Sp8CompositeScore,
  Sp8ModelStats,
  Sp8TaskClass,
  Sp8ToolCall,
  Sp8Trajectory,
} from "./types.js";
import { ALL_TASK_CLASSES, DEFAULT_BENCH_CONFIG } from "./types.js";

export type Sp8BenchEngineDeps = {
  stateDir: string;
  config?: Partial<Sp8BenchConfig>;
  nowMs?: () => number;
  fetchImpl?: typeof fetch;
};

export class Sp8BenchEngine {
  private readonly config: Sp8BenchConfig;
  private readonly statePath: string;
  private readonly nowMs: () => number;
  private readonly fetchImpl: typeof fetch;

  /** modelId -> taskClass -> ModelStats */
  private arms = new Map<string, Map<Sp8TaskClass, Sp8ModelStats>>();
  /** Ring buffer of recent trajectories. */
  private trajectories: RingBuffer<Sp8Trajectory>;
  /** Total requests processed. */
  private totalRequests = 0;
  /** Nightly evolution run counter. */
  private evolutionRuns = 0;
  /** Whether state has been loaded from disk. */
  private loaded = false;

  constructor(deps: Sp8BenchEngineDeps) {
    this.config = { ...DEFAULT_BENCH_CONFIG, ...deps.config };
    this.statePath = path.join(deps.stateDir, "sp8", "bench-state.json");
    this.nowMs = deps.nowMs ?? (() => Date.now());
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.trajectories = new RingBuffer<Sp8Trajectory>(this.config.maxTrajectories);
  }

  // --- State management ---

  /** Load persisted state from disk. Idempotent. */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Sp8BenchState>;

      if (!parsed || parsed.version !== 2) {
        return;
      }

      // Restore arms
      if (parsed.arms && typeof parsed.arms === "object") {
        for (const [modelId, taskMap] of Object.entries(parsed.arms)) {
          if (!taskMap || typeof taskMap !== "object") {
            continue;
          }
          const modelArms = new Map<Sp8TaskClass, Sp8ModelStats>();
          for (const [tc, stats] of Object.entries(taskMap)) {
            if (ALL_TASK_CLASSES.includes(tc as Sp8TaskClass) && stats) {
              modelArms.set(tc as Sp8TaskClass, {
                ...createArm(),
                ...(stats as Partial<Sp8ModelStats>),
              });
            }
          }
          if (modelArms.size > 0) {
            this.arms.set(modelId, modelArms);
          }
        }
      }

      // Restore trajectories
      if (Array.isArray(parsed.trajectories)) {
        this.trajectories = RingBuffer.fromSnapshot<Sp8Trajectory>(
          parsed.trajectories,
          parsed.trajectoryHead ?? 0,
          this.config.maxTrajectories,
        );
      }

      this.totalRequests = typeof parsed.totalRequests === "number" ? parsed.totalRequests : 0;
      this.evolutionRuns = typeof parsed.evolutionRuns === "number" ? parsed.evolutionRuns : 0;
    } catch (err) {
      if (!String(err).includes("ENOENT")) {
        throw err;
      }
    }
  }

  /** Persist current state to disk. */
  async save(): Promise<void> {
    const armsObj: Record<string, Record<string, Sp8ModelStats>> = {};
    for (const [modelId, taskMap] of this.arms.entries()) {
      armsObj[modelId] = {};
      for (const [tc, stats] of taskMap.entries()) {
        armsObj[modelId][tc] = stats;
      }
    }

    const state: Sp8BenchState = {
      version: 2,
      updatedAt: new Date(this.nowMs()).toISOString(),
      arms: armsObj,
      trajectories: this.trajectories.toArray(),
      trajectoryHead: this.trajectories.snapshot().head,
      totalRequests: this.totalRequests,
      evolutionRuns: this.evolutionRuns,
    };

    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  }

  // --- Arm access ---

  private getOrCreateArm(modelId: string, taskClass: Sp8TaskClass): Sp8ModelStats {
    let taskMap = this.arms.get(modelId);
    if (!taskMap) {
      taskMap = new Map();
      this.arms.set(modelId, taskMap);
    }
    let arm = taskMap.get(taskClass);
    if (!arm) {
      arm = createArm();
      taskMap.set(taskClass, arm);
    }
    return arm;
  }

  // --- Loop A: Online per-request update ---

  /**
   * Record an observation after a request completes.
   * This is the main Loop A entry point — called after every agent response.
   *
   * 1. Classify the task (cheap keyword match)
   * 2. Score via judge (if enabled) or heuristic fallback
   * 3. Update bandit arm
   * 4. Store trajectory
   * 5. Trigger evolution check if interval reached
   */
  async recordObservation(params: {
    query: string;
    modelUsed: string;
    toolsCalled: Sp8ToolCall[];
    finalAnswer: string;
    latencyMs: number;
    tokens: number;
    /** Set this after the user's next message is available. */
    successSignals?: {
      nextUserMessage: string | null;
      userThumbs: boolean | null;
      conversationContinued: boolean;
    };
  }): Promise<Sp8CompositeScore> {
    await this.load();

    const taskClass = classifyTaskClass(params.query);

    // Score via judge or heuristic
    let judgeScore: number;
    if (this.config.judgeEnabled) {
      const result = await runJudge({
        endpoint: this.config.judgeEndpoint,
        model: this.config.judgeModel,
        query: params.query,
        toolsCalled: params.toolsCalled,
        finalAnswer: params.finalAnswer,
        deps: { fetchImpl: this.fetchImpl },
      });
      judgeScore = result.score;
    } else {
      judgeScore = heuristicScore({
        toolsCalled: params.toolsCalled,
        finalAnswer: params.finalAnswer,
        latencyMs: params.latencyMs,
      });
    }

    // Compute success proxy (may be partial if next message not yet available)
    const agentErrored =
      params.finalAnswer.toLowerCase().includes("error") &&
      params.finalAnswer.toLowerCase().includes("sorry");
    const failedToolCalls = params.toolsCalled.filter((t) => !t.success).length;

    const proxyScore = params.successSignals
      ? computeSuccessProxy({
          ...params.successSignals,
          agentErrored,
          failedToolCalls,
          totalToolCalls: params.toolsCalled.length,
        })
      : 0.5; // Default neutral until we have user signal

    const score = compositeScore(
      judgeScore,
      proxyScore,
      this.config.judgeWeight,
      this.config.proxyWeight,
    );

    // Update bandit arm
    const arm = this.getOrCreateArm(params.modelUsed, taskClass);
    updateArm(arm, score, params.tokens, params.latencyMs, this.config.recentScoresWindow);

    // Store trajectory
    const trajectory: Sp8Trajectory = {
      queryHash: hashQuery(params.query),
      modelUsed: params.modelUsed,
      taskClass,
      toolsCalled: params.toolsCalled.slice(-6), // Keep last 6 for storage
      judgeScore,
      successProxy: proxyScore,
      userThumbs: params.successSignals?.userThumbs ?? null,
      timestamp: this.nowMs(),
      tokens: params.tokens,
      latencyMs: params.latencyMs,
    };
    this.trajectories.push(trajectory);

    this.totalRequests += 1;

    // Check if we should trigger evolution
    if (this.totalRequests > 0 && this.totalRequests % this.config.evolutionTriggerInterval === 0) {
      await this.runEvolution();
    }

    await this.save();

    return { judgeScore, successProxy: proxyScore, composite: score };
  }

  /**
   * Update the success proxy for a recent trajectory retroactively.
   * Called when the user's next message becomes available.
   */
  async updateProxy(params: {
    modelUsed: string;
    nextUserMessage: string | null;
    userThumbs: boolean | null;
    conversationContinued: boolean;
  }): Promise<void> {
    await this.load();

    const recent = this.trajectories.recent(5);
    const match = recent.find((t) => t.modelUsed === params.modelUsed);
    if (!match) {
      return;
    }

    const failedToolCalls = match.toolsCalled.filter((t) => !t.success).length;
    const newProxy = computeSuccessProxy({
      nextUserMessage: params.nextUserMessage,
      userThumbs: params.userThumbs,
      conversationContinued: params.conversationContinued,
      agentErrored: false,
      failedToolCalls,
      totalToolCalls: match.toolsCalled.length,
    });

    // Compute delta and apply correction to the arm
    const proxyDelta = newProxy - match.successProxy;
    if (Math.abs(proxyDelta) > 0.01) {
      const scoreDelta = proxyDelta * this.config.proxyWeight;
      const arm = this.getOrCreateArm(match.modelUsed, match.taskClass);
      // Apply correction: adjust alpha/beta by the delta
      if (scoreDelta > 0) {
        arm.alpha += scoreDelta;
      } else {
        arm.beta += Math.abs(scoreDelta);
      }
      match.successProxy = newProxy;
      await this.save();
    }
  }

  // --- Loop B: Periodic mini-evolution ---

  /**
   * Run the periodic evolution step.
   * Samples recent trajectories, computes aggregate stats,
   * and promotes/demotes routing weights.
   */
  async runEvolution(): Promise<{
    promoted: string[];
    demoted: string[];
    degrading: string[];
  }> {
    await this.load();

    const promoted: string[] = [];
    const demoted: string[] = [];
    const degrading: string[] = [];

    // Sample recent trajectories stratified by task class
    const recent = this.trajectories.recent(this.config.nightlySampleSize);

    // Group by model+taskClass and compute aggregates
    const groups = new Map<string, { scores: number[]; model: string; tc: Sp8TaskClass }>();
    for (const traj of recent) {
      const key = `${traj.modelUsed}::${traj.taskClass}`;
      const group = groups.get(key) ?? {
        scores: [],
        model: traj.modelUsed,
        tc: traj.taskClass,
      };
      group.scores.push(
        compositeScore(
          traj.judgeScore,
          traj.successProxy,
          this.config.judgeWeight,
          this.config.proxyWeight,
        ),
      );
      groups.set(key, group);
    }

    // Compute per-group mean and compare to overall mean
    const allScores = [...groups.values()].flatMap((g) => g.scores);
    const overallMean =
      allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0.5;

    for (const [_key, group] of groups.entries()) {
      if (group.scores.length < 2) {
        continue; // Not enough data
      }

      const groupMean = group.scores.reduce((a, b) => a + b, 0) / group.scores.length;
      const arm = this.getOrCreateArm(group.model, group.tc);

      // Check for degradation trend
      if (isDegrading(arm)) {
        degrading.push(`${group.model}/${group.tc}`);
      }

      // Promote if significantly above average
      if (groupMean > overallMean + 0.15 && arm.pulls >= this.config.minPullsForDemotion) {
        promoteArm(arm, 2);
        promoted.push(`${group.model}/${group.tc}`);
      }

      // Demote if significantly below average
      if (groupMean < overallMean - 0.15 && arm.pulls >= this.config.minPullsForDemotion) {
        demoteArm(arm, 2);
        demoted.push(`${group.model}/${group.tc}`);
      }
    }

    this.evolutionRuns += 1;
    await this.save();

    return { promoted, demoted, degrading };
  }

  // --- Model selection ---

  /**
   * Get ranked model IDs for a query using the bandit.
   * Falls back to all known models if no data for the task class.
   */
  selectModels(query: string, method: "thompson" | "ucb1" = "thompson"): string[] {
    const taskClass = classifyTaskClass(query);
    const armsForTask = new Map<string, Sp8ModelStats>();

    for (const [modelId, taskMap] of this.arms.entries()) {
      const arm = taskMap.get(taskClass);
      if (arm) {
        armsForTask.set(modelId, arm);
      }
    }

    if (armsForTask.size === 0) {
      return []; // No data — caller should fall back to default routing
    }

    return selectArms(armsForTask, method);
  }

  // --- Manual overrides ---

  /** Manually promote a model for a task class. */
  async manualPromote(modelId: string, taskClass: Sp8TaskClass, strength = 5): Promise<void> {
    await this.load();
    const arm = this.getOrCreateArm(modelId, taskClass);
    promoteArm(arm, strength);
    await this.save();
  }

  /** Manually demote a model for a task class. */
  async manualDemote(modelId: string, taskClass: Sp8TaskClass, strength = 5): Promise<void> {
    await this.load();
    const arm = this.getOrCreateArm(modelId, taskClass);
    demoteArm(arm, strength);
    await this.save();
  }

  // --- Reporting ---

  /** Get a summary of router stats for CLI display. */
  getRouterStats(): {
    totalRequests: number;
    evolutionRuns: number;
    trajectoryCount: number;
    models: Array<{
      modelId: string;
      taskClass: Sp8TaskClass;
      pulls: number;
      winRate: number;
      avgLatencyMs: number;
      tokensUsed: number;
      trend: "up" | "down" | "stable";
      recentAvg: number;
    }>;
  } {
    const models: Array<{
      modelId: string;
      taskClass: Sp8TaskClass;
      pulls: number;
      winRate: number;
      avgLatencyMs: number;
      tokensUsed: number;
      trend: "up" | "down" | "stable";
      recentAvg: number;
    }> = [];

    for (const [modelId, taskMap] of this.arms.entries()) {
      for (const [tc, arm] of taskMap.entries()) {
        if (arm.pulls === 0) {
          continue;
        }

        const recentAvg =
          arm.recentScores.length > 0
            ? arm.recentScores.reduce((a, b) => a + b, 0) / arm.recentScores.length
            : armMean(arm);

        models.push({
          modelId,
          taskClass: tc,
          pulls: arm.pulls,
          winRate: armMean(arm),
          avgLatencyMs: Math.round(arm.avgLatencyMs),
          tokensUsed: arm.tokensUsed,
          trend: isDegrading(arm) ? "down" : recentAvg > armMean(arm) + 0.05 ? "up" : "stable",
          recentAvg: Math.round(recentAvg * 100) / 100,
        });
      }
    }

    // Sort by pulls descending
    models.sort((a, b) => b.pulls - a.pulls);

    return {
      totalRequests: this.totalRequests,
      evolutionRuns: this.evolutionRuns,
      trajectoryCount: this.trajectories.size,
      models,
    };
  }

  /** Get a weekly evolution report for CLI display. */
  getEvolutionReport(daysBack = 7): {
    period: { from: number; to: number };
    totalTrajectories: number;
    byTaskClass: Record<Sp8TaskClass, { count: number; avgScore: number }>;
    topModels: Array<{ modelId: string; avgScore: number; pulls: number }>;
    bottomModels: Array<{ modelId: string; avgScore: number; pulls: number }>;
  } {
    const now = this.nowMs();
    const cutoff = now - daysBack * 24 * 60 * 60 * 1000;
    const trajectories = this.trajectories.toArray().filter((t) => t.timestamp >= cutoff);

    const byTaskClass = {} as Record<Sp8TaskClass, { count: number; avgScore: number }>;
    for (const tc of ALL_TASK_CLASSES) {
      const matching = trajectories.filter((t) => t.taskClass === tc);
      const scores = matching.map((t) =>
        compositeScore(
          t.judgeScore,
          t.successProxy,
          this.config.judgeWeight,
          this.config.proxyWeight,
        ),
      );
      byTaskClass[tc] = {
        count: matching.length,
        avgScore:
          scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : 0,
      };
    }

    // Aggregate by model
    const modelScores = new Map<string, { scores: number[]; pulls: number }>();
    for (const traj of trajectories) {
      const entry = modelScores.get(traj.modelUsed) ?? { scores: [], pulls: 0 };
      entry.scores.push(
        compositeScore(
          traj.judgeScore,
          traj.successProxy,
          this.config.judgeWeight,
          this.config.proxyWeight,
        ),
      );
      entry.pulls += 1;
      modelScores.set(traj.modelUsed, entry);
    }

    const modelList = [...modelScores.entries()]
      .map(([modelId, data]) => ({
        modelId,
        avgScore:
          Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100) / 100,
        pulls: data.pulls,
      }))
      .toSorted((a, b) => b.avgScore - a.avgScore);

    return {
      period: { from: cutoff, to: now },
      totalTrajectories: trajectories.length,
      byTaskClass,
      topModels: modelList.slice(0, 5),
      bottomModels: modelList.slice(-3).toReversed(),
    };
  }
}
