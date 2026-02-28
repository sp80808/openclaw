/**
 * CLI report formatting for the self-benchmarking system.
 * Renders text tables + trend indicators for terminal display.
 */

import type { Sp8TaskClass } from "./types.js";

type RouterStatsRow = {
  modelId: string;
  taskClass: Sp8TaskClass;
  pulls: number;
  winRate: number;
  avgLatencyMs: number;
  tokensUsed: number;
  trend: "up" | "down" | "stable";
  recentAvg: number;
};

type EvolutionReportData = {
  period: { from: number; to: number };
  totalTrajectories: number;
  byTaskClass: Record<Sp8TaskClass, { count: number; avgScore: number }>;
  topModels: Array<{ modelId: string; avgScore: number; pulls: number }>;
  bottomModels: Array<{ modelId: string; avgScore: number; pulls: number }>;
};

const TREND_ICON: Record<string, string> = {
  up: "▲",
  down: "▼",
  stable: "─",
};

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;
}

function pct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

/**
 * Format router stats as a plain-text table.
 */
export function formatRouterStats(stats: {
  totalRequests: number;
  evolutionRuns: number;
  trajectoryCount: number;
  models: RouterStatsRow[];
}): string {
  const lines: string[] = [];

  lines.push("SP8 Router Benchmark Stats");
  lines.push("─".repeat(72));
  lines.push(
    `Requests: ${stats.totalRequests}  |  Evolutions: ${stats.evolutionRuns}  |  Trajectories: ${stats.trajectoryCount}`,
  );
  lines.push("");

  if (stats.models.length === 0) {
    lines.push("No model data yet. Run some requests to populate stats.");
    return lines.join("\n");
  }

  // Table header
  lines.push(
    `${pad("Model", 30)} ${pad("Task", 10)} ${padRight("Pulls", 6)} ${padRight("Win%", 7)} ${padRight("Recent", 7)} ${padRight("Lat(ms)", 8)} ${padRight("Tokens", 10)} Trend`,
  );
  lines.push("─".repeat(90));

  for (const row of stats.models) {
    const shortModel = row.modelId.length > 28 ? `…${row.modelId.slice(-27)}` : row.modelId;
    lines.push(
      `${pad(shortModel, 30)} ${pad(row.taskClass, 10)} ${padRight(String(row.pulls), 6)} ${padRight(pct(row.winRate), 7)} ${padRight(pct(row.recentAvg), 7)} ${padRight(String(row.avgLatencyMs), 8)} ${padRight(String(row.tokensUsed), 10)} ${TREND_ICON[row.trend] ?? "─"}`,
    );
  }

  return lines.join("\n");
}

/**
 * Format evolution report as a plain-text summary.
 */
export function formatEvolutionReport(data: EvolutionReportData): string {
  const lines: string[] = [];

  const from = new Date(data.period.from).toISOString().slice(0, 10);
  const to = new Date(data.period.to).toISOString().slice(0, 10);

  lines.push(`SP8 Evolution Report: ${from} → ${to}`);
  lines.push("─".repeat(52));
  lines.push(`Total trajectories in period: ${data.totalTrajectories}`);
  lines.push("");

  // Task class breakdown
  lines.push("By Task Class:");
  for (const [tc, info] of Object.entries(data.byTaskClass)) {
    if (info.count > 0) {
      lines.push(
        `  ${pad(tc, 12)} ${padRight(String(info.count), 5)} requests  avg: ${pct(info.avgScore)}`,
      );
    }
  }
  lines.push("");

  // Top models
  if (data.topModels.length > 0) {
    lines.push("Top Models:");
    for (const m of data.topModels) {
      const shortId = m.modelId.length > 35 ? `…${m.modelId.slice(-34)}` : m.modelId;
      lines.push(`  ${pad(shortId, 36)} avg: ${pct(m.avgScore)}  pulls: ${m.pulls}`);
    }
    lines.push("");
  }

  // Bottom models
  if (data.bottomModels.length > 0) {
    lines.push("Needs Improvement:");
    for (const m of data.bottomModels) {
      const shortId = m.modelId.length > 35 ? `…${m.modelId.slice(-34)}` : m.modelId;
      lines.push(`  ${pad(shortId, 36)} avg: ${pct(m.avgScore)}  pulls: ${m.pulls}`);
    }
  }

  return lines.join("\n");
}
