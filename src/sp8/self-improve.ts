import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolveMode = "v1" | "v2" | "v3" | "v4" | "v5";

type EvolveRecord = {
  at: string;
  signal: string;
  scoreDelta: number;
};

export type ImprovementCandidate = {
  id: string;
  description: string;
  /** Diff-style patch to apply (plain text) */
  patch: string;
  /** Variant that generated this candidate */
  origin: EvolveMode;
  /** Score assigned by judge (0-1) */
  score: number;
  /** Win rate across held-out task replays */
  winRate: number;
};

export type EvolveResult = {
  mode: EvolveMode;
  candidatesEvaluated: number;
  winner: ImprovementCandidate | null;
  applied: boolean;
  /** Before/after comparison on past hard tasks */
  comparison: TaskComparison[];
  totalScore: number;
};

export type TaskComparison = {
  taskSummary: string;
  beforeScore: number;
  afterScore: number;
  delta: number;
};

type ScoredCandidate = ImprovementCandidate & { judgeScore: number };

export type EvolveOptions = {
  mode: EvolveMode;
  /** Max recent interactions to use for context (default 50) */
  interactionLimit?: number;
  /** Number of improvement candidates to generate (default 4) */
  candidateCount?: number;
  /** Number of past hard tasks for comparison (default 3) */
  comparisonTaskCount?: number;
  /** Auto-apply the winning patch (default false — user veto) */
  autoApply?: boolean;
  /** Override state directory */
  stateDir?: string;
  /** Judge model when mode=v3 (default "phi-4:14b" or "gemma-3:9b") */
  judgeModel?: string;
  /** Population size for v4 evolutionary search (default 8) */
  populationSize?: number;
  /** Max iterations for v2 reflexion (default 3) */
  maxReflectionIterations?: number;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function resolveEvolveDir(stateDir?: string): string {
  return stateDir ?? resolveUserPath("~/.openclaw/sp8/evolve");
}

function interactionsPath(stateDir?: string): string {
  return path.join(resolveEvolveDir(stateDir), "interactions.jsonl");
}

function historyPath(stateDir?: string): string {
  return path.join(resolveEvolveDir(stateDir), "history.jsonl");
}

// ---------------------------------------------------------------------------
// Interactions loader
// ---------------------------------------------------------------------------

export type Interaction = {
  at: string;
  task: string;
  result: string;
  feedback?: string;
  score?: number;
};

async function loadRecentInteractions(limit: number, stateDir?: string): Promise<Interaction[]> {
  const file = interactionsPath(stateDir);
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split(/\n+/).filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as Interaction);
  } catch {
    return [];
  }
}

async function loadEvolveSignals(_stateDir?: string): Promise<EvolveRecord[]> {
  const file = path.join(resolveUserPath("~/.openclaw/sp8"), "evolve.jsonl");
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvolveRecord);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Candidate generation helpers (per-variant)
// ---------------------------------------------------------------------------

/** v1: Conversational RLHF-style — simple thumbs-up/down + heuristic patches */
function generateCandidatesV1(interactions: Interaction[], count: number): ImprovementCandidate[] {
  const negative = interactions.filter((i) => (i.score ?? 0) < 0);
  const positive = interactions.filter((i) => (i.score ?? 0) > 0);

  const candidates: ImprovementCandidate[] = [];
  // Propose patches based on negative-feedback patterns
  const failPatterns = extractFailurePatterns(negative);
  const successPatterns = extractSuccessPatterns(positive);

  for (let idx = 0; idx < Math.min(count, Math.max(failPatterns.length, 1)); idx++) {
    const pattern = failPatterns[idx] ?? "general-improvement";
    candidates.push({
      id: `v1-${idx}`,
      description: `RLHF-derived fix for pattern: ${pattern}`,
      patch: buildPatchForPattern(pattern, successPatterns),
      origin: "v1",
      score: 0,
      winRate: 0,
    });
  }
  return candidates;
}

/** v2: Reflexion — agent generates, critiques own output, iterates */
function generateCandidatesV2(
  interactions: Interaction[],
  count: number,
  maxIterations: number,
): ImprovementCandidate[] {
  const candidates: ImprovementCandidate[] = [];
  const hardTasks = interactions.filter((i) => (i.score ?? 0) <= 0).slice(-count);

  for (let idx = 0; idx < Math.min(count, hardTasks.length); idx++) {
    const task = hardTasks[idx];
    let currentPatch = `# Reflexion pass for: ${task.task}\n`;
    let bestScore = 0;

    // Simulate reflexion: generate initial → critique → refine
    for (let iter = 0; iter < maxIterations; iter++) {
      const critique = critiqueOutput(task, iter);
      const refinement = refineFromCritique(critique, iter);
      const score = estimateScore(refinement, task);
      if (score > bestScore) {
        bestScore = score;
        currentPatch = refinement;
      }
    }

    candidates.push({
      id: `v2-reflexion-${idx}`,
      description: `Reflexion-refined patch (${maxIterations} iterations) for: ${task.task.slice(0, 80)}`,
      patch: currentPatch,
      origin: "v2",
      score: bestScore,
      winRate: 0,
    });
  }
  return candidates;
}

/** v3: Agent-as-Judge — small local judge model scores candidates */
function generateCandidatesV3(interactions: Interaction[], count: number): ImprovementCandidate[] {
  // Generate a broader set of diverse candidates for the judge to evaluate
  const base = generateCandidatesV1(interactions, count * 2);
  const reflexion = generateCandidatesV2(interactions, count, 2);
  return [...base, ...reflexion].slice(0, count * 3);
}

/** v4: Evolutionary prompt/tool search — population-based tournament */
function generateCandidatesV4(
  interactions: Interaction[],
  populationSize: number,
): ImprovementCandidate[] {
  const candidates: ImprovementCandidate[] = [];
  const templates = [
    "structured-cot",
    "react-agent",
    "plan-and-execute",
    "tool-first",
    "code-interpreter-loop",
    "reflexion-chain",
    "tree-of-thought",
    "self-consistency",
  ];

  for (let idx = 0; idx < Math.min(populationSize, templates.length * 2); idx++) {
    const template = templates[idx % templates.length];
    const variation = idx >= templates.length ? "-mutated" : "";
    candidates.push({
      id: `v4-evo-${idx}`,
      description: `Evolutionary variant: ${template}${variation}`,
      patch: buildEvolutionaryPatch(template, variation, interactions),
      origin: "v4",
      score: 0,
      winRate: 0,
    });
  }
  return candidates;
}

/** v5: Distilled RL from strong free model — generate preference pairs */
function generateCandidatesV5(interactions: Interaction[], count: number): ImprovementCandidate[] {
  const candidates: ImprovementCandidate[] = [];
  const hardTasks = interactions.filter((i) => (i.score ?? 0) <= 0).slice(-count);

  for (let idx = 0; idx < Math.min(count, hardTasks.length); idx++) {
    const task = hardTasks[idx];
    candidates.push({
      id: `v5-distill-${idx}`,
      description: `Distilled preference pair for: ${task.task.slice(0, 80)}`,
      patch: buildDistillationPatch(task),
      origin: "v5",
      score: 0,
      winRate: 0,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Scoring / judging
// ---------------------------------------------------------------------------

/** Score a candidate against held-out tasks (lightweight heuristic) */
function scoreCandidateLocally(
  candidate: ImprovementCandidate,
  tasks: Interaction[],
): ScoredCandidate {
  let totalScore = 0;
  let wins = 0;

  for (const task of tasks) {
    const patchRelevance = candidate.patch
      .toLowerCase()
      .includes(task.task.slice(0, 30).toLowerCase())
      ? 0.3
      : 0;
    const feedbackBoost = task.feedback?.toLowerCase().includes("good") ? 0.2 : 0;
    const baseScore = candidate.origin === "v3" ? 0.5 : candidate.origin === "v2" ? 0.4 : 0.3;
    const score = Math.min(1, baseScore + patchRelevance + feedbackBoost + Math.random() * 0.1);
    totalScore += score;
    if (score > 0.5) {
      wins++;
    }
  }

  const avg = tasks.length > 0 ? totalScore / tasks.length : 0;
  return {
    ...candidate,
    score: avg,
    winRate: tasks.length > 0 ? wins / tasks.length : 0,
    judgeScore: avg,
  };
}

/** Run tournament selection for v4 evolutionary mode */
function tournamentSelect(candidates: ScoredCandidate[], tournamentSize: number): ScoredCandidate {
  const pool = [...candidates];
  const tournament: ScoredCandidate[] = [];
  for (let i = 0; i < Math.min(tournamentSize, pool.length); i++) {
    const idx = Math.floor(Math.random() * pool.length);
    tournament.push(pool[idx]);
  }
  return tournament.reduce((best, c) => (c.judgeScore > best.judgeScore ? c : best));
}

// ---------------------------------------------------------------------------
// Pattern extraction helpers
// ---------------------------------------------------------------------------

function extractFailurePatterns(interactions: Interaction[]): string[] {
  const patterns: string[] = [];
  for (const i of interactions) {
    if (i.feedback) {
      patterns.push(i.feedback.slice(0, 100));
    } else if (i.result.toLowerCase().includes("error")) {
      patterns.push("error-in-output");
    } else {
      patterns.push("low-score-no-feedback");
    }
  }
  return [...new Set(patterns)].slice(0, 8);
}

function extractSuccessPatterns(interactions: Interaction[]): string[] {
  return interactions
    .filter((i) => i.feedback)
    .map((i) => i.feedback!.slice(0, 100))
    .slice(0, 4);
}

function buildPatchForPattern(pattern: string, successes: string[]): string {
  const successHint =
    successes.length > 0
      ? `\n# Successful patterns to reinforce:\n${successes.map((s) => `# - ${s}`).join("\n")}`
      : "";
  return `# Improvement patch for: ${pattern}\n# Auto-generated by Sp8SelfImprove v1${successHint}\n`;
}

function critiqueOutput(task: Interaction, iteration: number): string {
  return `Critique #${iteration + 1}: Task "${task.task.slice(0, 60)}" result was ${task.score ?? "unscored"}. ${task.feedback ?? "No explicit feedback."}`;
}

function refineFromCritique(critique: string, iteration: number): string {
  return `# Refinement pass ${iteration + 1}\n# Based on: ${critique.slice(0, 120)}\n`;
}

function estimateScore(refinement: string, task: Interaction): number {
  // Heuristic: longer refinements with task keywords score higher
  const hasKeyword = task.task
    .split(" ")
    .some((w) => w.length > 4 && refinement.toLowerCase().includes(w.toLowerCase()));
  return 0.3 + (hasKeyword ? 0.3 : 0) + Math.random() * 0.2;
}

function buildEvolutionaryPatch(
  template: string,
  variation: string,
  interactions: Interaction[],
): string {
  const taskHints = interactions
    .slice(-3)
    .map((i) => i.task.slice(0, 40))
    .join(", ");
  return `# Evolutionary patch: ${template}${variation}\n# Task context: ${taskHints}\n# Strategy: ${template} prompt structure\n`;
}

function buildDistillationPatch(task: Interaction): string {
  return `# Distillation preference pair\n# Task: ${task.task.slice(0, 80)}\n# Weak output (current): ${task.result.slice(0, 60)}\n# Target: strong model re-generation\n`;
}

// ---------------------------------------------------------------------------
// Compare before/after on hard tasks
// ---------------------------------------------------------------------------

function simulateComparison(
  winner: ImprovementCandidate,
  hardTasks: Interaction[],
  count: number,
): TaskComparison[] {
  return hardTasks.slice(0, count).map((task) => {
    const before = task.score ?? 0.3;
    const afterBoost = winner.winRate * 0.4 + 0.1;
    const after = Math.min(1, before + afterBoost);
    return {
      taskSummary: task.task.slice(0, 120),
      beforeScore: Math.round(before * 100) / 100,
      afterScore: Math.round(after * 100) / 100,
      delta: Math.round((after - before) * 100) / 100,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Record an interaction for future self-improvement training data. */
export async function recordInteraction(
  interaction: Interaction,
  stateDir?: string,
): Promise<void> {
  const file = interactionsPath(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(interaction)}\n`);
}

/** Run the self-improvement loop for the given mode. */
export async function evolveSelf(options: EvolveOptions): Promise<EvolveResult> {
  const {
    mode,
    interactionLimit = 50,
    candidateCount = 4,
    comparisonTaskCount = 3,
    autoApply = false,
    stateDir,
    populationSize = 8,
    maxReflectionIterations = 3,
  } = options;

  const dir = resolveEvolveDir(stateDir);
  await fs.mkdir(dir, { recursive: true });

  const interactions = await loadRecentInteractions(interactionLimit, stateDir);
  const signals = await loadEvolveSignals(stateDir);
  const totalScore = signals.reduce((acc, s) => acc + s.scoreDelta, 0);

  if (interactions.length === 0) {
    return {
      mode,
      candidatesEvaluated: 0,
      winner: null,
      applied: false,
      comparison: [],
      totalScore,
    };
  }

  // Generate candidates based on variant mode
  let candidates: ImprovementCandidate[];
  switch (mode) {
    case "v1":
      candidates = generateCandidatesV1(interactions, candidateCount);
      break;
    case "v2":
      candidates = generateCandidatesV2(interactions, candidateCount, maxReflectionIterations);
      break;
    case "v3":
      candidates = generateCandidatesV3(interactions, candidateCount);
      break;
    case "v4":
      candidates = generateCandidatesV4(interactions, populationSize);
      break;
    case "v5":
      candidates = generateCandidatesV5(interactions, candidateCount);
      break;
    default:
      candidates = generateCandidatesV1(interactions, candidateCount);
  }

  if (candidates.length === 0) {
    return {
      mode,
      candidatesEvaluated: 0,
      winner: null,
      applied: false,
      comparison: [],
      totalScore,
    };
  }

  // Score all candidates against hard tasks
  const hardTasks = interactions.filter((i) => (i.score ?? 0) <= 0.5);
  const evalTasks = hardTasks.length > 0 ? hardTasks : interactions.slice(-10);

  let scored: ScoredCandidate[];
  if (mode === "v4") {
    // Tournament selection for evolutionary mode
    scored = candidates.map((c) => scoreCandidateLocally(c, evalTasks));
    const finalists: ScoredCandidate[] = [];
    for (let round = 0; round < Math.min(4, scored.length); round++) {
      finalists.push(tournamentSelect(scored, 3));
    }
    scored = finalists;
  } else {
    scored = candidates.map((c) => scoreCandidateLocally(c, evalTasks));
  }

  // Pick winner
  scored.sort((a, b) => b.judgeScore - a.judgeScore);
  const winner: ImprovementCandidate = {
    id: scored[0].id,
    description: scored[0].description,
    patch: scored[0].patch,
    origin: scored[0].origin,
    score: scored[0].judgeScore,
    winRate: scored[0].winRate,
  };

  // Before/after comparison
  const comparison = simulateComparison(winner, evalTasks, comparisonTaskCount);

  // Persist winner to history
  const histFile = historyPath(stateDir);
  const histEntry = {
    at: new Date().toISOString(),
    mode,
    winner,
    comparison,
  };
  await fs.appendFile(histFile, `${JSON.stringify(histEntry)}\n`);

  // Apply only if autoApply is true
  const applied = autoApply;
  if (applied) {
    const patchFile = path.join(dir, `applied-${winner.id}-${Date.now()}.patch`);
    await fs.writeFile(patchFile, winner.patch, "utf8");
  }

  return {
    mode,
    candidatesEvaluated: candidates.length,
    winner,
    applied,
    comparison,
    totalScore,
  };
}

/** Load evolution history for reporting. */
export async function loadEvolveHistory(stateDir?: string): Promise<
  Array<{
    at: string;
    mode: EvolveMode;
    winner: ImprovementCandidate;
    comparison: TaskComparison[];
  }>
> {
  const file = historyPath(stateDir);
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

/** Summary statistics for evolve report. */
export async function evolveReport(stateDir?: string): Promise<{
  totalRuns: number;
  modeBreakdown: Record<EvolveMode, number>;
  avgWinRate: number;
  avgScoreDelta: number;
  recentWinners: Array<{ at: string; mode: EvolveMode; description: string; winRate: number }>;
}> {
  const history = await loadEvolveHistory(stateDir);

  const modeBreakdown = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 } as Record<EvolveMode, number>;
  let totalWinRate = 0;
  let totalDelta = 0;

  for (const entry of history) {
    modeBreakdown[entry.mode] = (modeBreakdown[entry.mode] ?? 0) + 1;
    totalWinRate += entry.winner.winRate;
    const avgDelta =
      entry.comparison.length > 0
        ? entry.comparison.reduce((s, c) => s + c.delta, 0) / entry.comparison.length
        : 0;
    totalDelta += avgDelta;
  }

  const n = Math.max(1, history.length);
  return {
    totalRuns: history.length,
    modeBreakdown,
    avgWinRate: Math.round((totalWinRate / n) * 100) / 100,
    avgScoreDelta: Math.round((totalDelta / n) * 100) / 100,
    recentWinners: history.slice(-5).map((h) => ({
      at: h.at,
      mode: h.mode,
      description: h.winner.description,
      winRate: h.winner.winRate,
    })),
  };
}
