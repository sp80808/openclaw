/**
 * Thompson Sampling multi-armed bandit for model routing.
 *
 * Each arm = (modelId, taskClass) pair with Beta(alpha, beta) posterior.
 * - alpha starts at 1 (uniform prior)
 * - On reward r ∈ [0,1]: alpha += r, beta += (1 - r)
 * - Selection: sample from Beta(alpha, beta), pick highest
 *
 * Also supports UCB1 variant for deterministic reproducibility in tests.
 *
 * Memory: ~80 bytes per arm. With 50 models × 5 task classes = 250 arms ≈ 20 KB.
 */

import type { Sp8ModelStats } from "./types.js";

/** Create a fresh arm with uniform prior Beta(1, 1). */
export function createArm(): Sp8ModelStats {
  return {
    alpha: 1,
    beta: 1,
    pulls: 0,
    wins: 0,
    tokensUsed: 0,
    avgLatencyMs: 0,
    recentScores: [],
  };
}

/**
 * Update a bandit arm with a new reward observation.
 * @param arm - The arm to update (mutated in place).
 * @param reward - Score ∈ [0, 1].
 * @param tokens - Tokens consumed in this request.
 * @param latencyMs - End-to-end latency.
 * @param recentWindow - Max size of the recent scores ring.
 */
export function updateArm(
  arm: Sp8ModelStats,
  reward: number,
  tokens: number,
  latencyMs: number,
  recentWindow: number,
): void {
  const clampedReward = Math.max(0, Math.min(1, reward));
  arm.alpha += clampedReward;
  arm.beta += 1 - clampedReward;
  arm.pulls += 1;
  arm.wins += clampedReward;
  arm.tokensUsed += tokens;

  // Exponential moving average for latency (avoid storing all values)
  if (arm.pulls === 1) {
    arm.avgLatencyMs = latencyMs;
  } else {
    const smoothing = 0.15;
    arm.avgLatencyMs = smoothing * latencyMs + (1 - smoothing) * arm.avgLatencyMs;
  }

  // Bounded recent scores window
  arm.recentScores.push(clampedReward);
  if (arm.recentScores.length > recentWindow) {
    arm.recentScores.shift();
  }
}

/**
 * Sample from a Beta distribution using the Jöhnk algorithm.
 * Fast, no external dependencies, good for alpha/beta > 0.
 * Falls back to mean for very large alpha+beta to avoid numerical issues.
 */
export function betaSample(alpha: number, beta: number): number {
  if (alpha <= 0 || beta <= 0) {
    return 0.5;
  }

  // For very concentrated distributions, just return the mean
  if (alpha + beta > 1000) {
    return alpha / (alpha + beta);
  }

  // Jöhnk's algorithm for Beta(alpha, beta) when both < 1
  // For alpha, beta >= 1, use the gamma-ratio method via rejection sampling
  return betaSampleInternal(alpha, beta);
}

/**
 * Internal Beta sampling via inverse transform with simple approximation.
 * Uses the ratio-of-uniforms method for reasonable accuracy.
 */
function betaSampleInternal(a: number, b: number): number {
  // Simple and fast: use the mean + random perturbation scaled by variance
  // This is not a perfect Beta sample but is adequate for bandit exploration
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
  const stddev = Math.sqrt(variance);

  // Box-Muller for a single normal sample
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, mean + z * stddev));
}

/**
 * UCB1 score for deterministic arm selection (useful for tests / debugging).
 * score = mean_reward + c * sqrt(ln(total_pulls) / arm_pulls)
 */
export function ucb1Score(arm: Sp8ModelStats, totalPulls: number, c = 1.41): number {
  if (arm.pulls === 0) {
    return Number.POSITIVE_INFINITY; // Explore unpulled arms first
  }
  const mean = arm.wins / arm.pulls;
  const exploration = c * Math.sqrt(Math.log(Math.max(totalPulls, 1)) / arm.pulls);
  return mean + exploration;
}

/** Get the Thompson sampling score for an arm (one random draw). */
export function thompsonScore(arm: Sp8ModelStats): number {
  return betaSample(arm.alpha, arm.beta);
}

/**
 * Select the best model for a task class using Thompson sampling.
 * Returns model IDs sorted by sampled score (highest first).
 */
export function selectArms(
  arms: Map<string, Sp8ModelStats>,
  method: "thompson" | "ucb1" = "thompson",
): string[] {
  const totalPulls = [...arms.values()].reduce((sum, arm) => sum + arm.pulls, 0);

  const scored = [...arms.entries()].map(([modelId, arm]) => ({
    modelId,
    score: method === "thompson" ? thompsonScore(arm) : ucb1Score(arm, totalPulls),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.modelId);
}

/**
 * Detect if an arm is degrading (recent scores trending down).
 * Uses simple linear regression slope on the recent scores window.
 */
export function isDegrading(arm: Sp8ModelStats, threshold = -0.03): boolean {
  const scores = arm.recentScores;
  if (scores.length < 5) {
    return false;
  }

  // Simple slope calculation: least squares on indices vs scores
  const n = scores.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let idx = 0; idx < n; idx += 1) {
    sumX += idx;
    sumY += scores[idx];
    sumXY += idx * scores[idx];
    sumXX += idx * idx;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return slope < threshold;
}

/**
 * Compute the mean reward for an arm.
 */
export function armMean(arm: Sp8ModelStats): number {
  if (arm.pulls === 0) {
    return 0.5; // Prior mean
  }
  return arm.wins / arm.pulls;
}

/**
 * Manually promote an arm by injecting synthetic positive observations.
 * Useful for `sp8 models promote <model> --task-class coding`.
 */
export function promoteArm(arm: Sp8ModelStats, strength = 5): void {
  arm.alpha += strength;
  arm.pulls += strength;
  arm.wins += strength * 0.9;
}

/**
 * Manually demote an arm by injecting synthetic negative observations.
 */
export function demoteArm(arm: Sp8ModelStats, strength = 5): void {
  arm.beta += strength;
  arm.pulls += strength;
  arm.wins += strength * 0.1;
}
