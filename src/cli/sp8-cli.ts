import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { launchAntigravityProject } from "../sp8/antigravity/bridge.js";
import { appendEvolutionSignal } from "../sp8/evolve.js";
import {
  createGeminiPkceAuthSession,
  exchangeGeminiOAuthCode,
  loadGeminiOAuthTokens,
  storeGeminiOAuthTokens,
} from "../sp8/gemini/oauth.js";
import { syncSp8Intake } from "../sp8/intake/sync.js";
import {
  addSp8McpServer,
  autoWrapSkillsAsMcpServers,
  readSp8McpConfig,
} from "../sp8/mcp/server-registry.js";
import { huntModels, getModelStatus, loadShadowHistory } from "../sp8/model-hunter.js";
import { buildFreeFirstPlan, recommendLocalProfile } from "../sp8/onboard/free-first.js";
import { Sp8Router } from "../sp8/router/sp8-router.js";
import { generateMetrics, renderWinRateChart } from "../sp8/safety-rails.js";
import {
  evolveSelf,
  evolveReport,
  recordInteraction,
  type EvolveMode,
} from "../sp8/self-improve.js";
import { createSp8Swarm } from "../sp8/swarm.js";
import { renderTable } from "../terminal/table.js";
import { CONFIG_DIR } from "../utils.js";

type Sp8Feature = {
  id: string;
  label: string;
  aliases: string[];
  fork: string;
  summary: string;
  skill: string;
  clawhubHint: string;
};

type Sp8State = {
  version: 1;
  updatedAt: string;
  features: Record<string, { enabled: boolean; enabledAt: string; sourceFork: string }>;
};

const FEATURES: Sp8Feature[] = [
  {
    id: "antigravity-gemini-oauth",
    label: "Antigravity + Gemini OAuth",
    aliases: ["antigravity", "gemini-oauth"],
    fork: "https://github.com/lutpd/openclaw-antigravity1",
    summary:
      "Remote-friendly PKCE OAuth with manual callback fallback for Gemini/Antigravity auth.",
    skill: "sp8-antigravity-gemini-oauth",
    clawhubHint: "google-antigravity-auth",
  },
  {
    id: "self-evolving-rl-loop",
    label: "Self-Evolving RL Loop",
    aliases: ["rl", "rl-loop", "openclaw-rl"],
    fork: "https://github.com/Gen-Verse/OpenClaw-RL",
    summary: "Fully async rollout/reward/train pipeline with non-blocking worker loops.",
    skill: "sp8-self-evolving-rl-loop",
    clawhubHint: "openclaw rl async",
  },
  {
    id: "cognitive-memory-kg",
    label: "Cognitive Memory / Personal KG",
    aliases: ["memory", "kg", "sqlite-vec", "raptor"],
    fork: "https://github.com/globalcaos/clawdbot-moltbot-openclaw",
    summary:
      "sqlite-vec + hybrid recall + nightly consolidation inspired by cognitive memory forks.",
    skill: "sp8-cognitive-memory-kg",
    clawhubHint: "sqlite-vec memory",
  },
  {
    id: "mcp-agent-teams",
    label: "MCP Servers & Agent Teams",
    aliases: ["mcp", "agent-teams", "claude-code-skill"],
    fork: "https://github.com/Enderfga/openclaw-claude-code-skill",
    summary:
      "Persistent MCP sessions, team roles, and tool-scoped guardrails for multi-agent workflows.",
    skill: "sp8-mcp-agent-teams",
    clawhubHint: "claude-code-skill",
  },
  {
    id: "resilient-browser-relay",
    label: "Resilient Browser Relay",
    aliases: ["relay", "browser-relay", "resilient-relay"],
    fork: "https://github.com/Unayung/openclaw-browser-relay",
    summary:
      "MV3 state restore, keepalive alarms, and reconnect/jitter patterns for long-lived browser control.",
    skill: "sp8-resilient-browser-relay",
    clawhubHint: "browser relay resilient",
  },
  {
    id: "time-travel-debugger",
    label: "Time-travel debugger",
    aliases: ["debugger", "timeline", "forked"],
    fork: "https://github.com/MurbotLabs/Forked",
    summary: "Trace capture + fork/rewind workflows for replay-driven debugging.",
    skill: "sp8-time-travel-debugger",
    clawhubHint: "forked openclaw",
  },
  {
    id: "local-first-routing",
    label: "Local-first routing",
    aliases: ["localclaw", "local-first", "routing"],
    fork: "https://github.com/search?q=LocalClaw+openclaw&type=repositories",
    summary:
      "Local-first routing and fallback strategy patterns from LocalClaw-style community forks.",
    skill: "sp8-local-first-routing",
    clawhubHint: "localclaw openclaw",
  },
];

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function resolveFeature(input: string): Sp8Feature | undefined {
  const normalized = normalizeName(input);
  return FEATURES.find((f) => f.id === normalized || f.aliases.includes(normalized));
}

function statePath(): string {
  return path.join(CONFIG_DIR, "sp8", "features.json");
}

async function readState(): Promise<Sp8State> {
  const filePath = statePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Sp8State>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      features: parsed.features && typeof parsed.features === "object" ? parsed.features : {},
    };
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), features: {} };
  }
}

async function writeState(state: Sp8State): Promise<void> {
  const filePath = statePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function featureList(): string {
  return FEATURES.map((f) => `- ${f.id}`).join("\n");
}

function hasBinary(binary: string): boolean {
  return spawnSync("which", [binary], { stdio: "ignore" }).status === 0;
}

export function registerSp8Cli(program: Command) {
  const sp8 = program.command("sp8").description("Sp8Claw controls and integrations");
  registerFeatureCommands(sp8);
  registerRouterCommands(sp8);
  registerOnboardCommand(sp8);
  registerSwarmCommand(sp8);
  registerAntigravityCommand(sp8);
  registerEvolveCommands(sp8);
  registerModelsCommands(sp8);
  registerIntakeCommands(sp8);
  registerMcpCommands(sp8);
  registerGeminiCommands(sp8);
}

function registerFeatureCommands(sp8: Command) {
  const feature = sp8.command("feature").description("Enable optional SP8 integrations");
  feature
    .command("enable")
    .description("Enable a fork-derived SP8 feature")
    .argument("<name>", "Feature id")
    .option("--json", "Output JSON", false)
    .action(async (name: string, opts: { json?: boolean }) => {
      const descriptor = resolveFeature(name);
      if (!descriptor) {
        if (opts.json) {
          defaultRuntime.log(
            JSON.stringify(
              {
                ok: false,
                error: "unknown_feature",
                requested: name,
                available: FEATURES.map((f) => f.id),
              },
              null,
              2,
            ),
          );
        } else {
          defaultRuntime.error(`Unknown SP8 feature: ${name}`);
          defaultRuntime.error("Available features:");
          defaultRuntime.error(featureList());
        }
        defaultRuntime.exit(1);
        return;
      }
      const now = new Date().toISOString();
      const state = await readState();
      state.updatedAt = now;
      state.features[descriptor.id] = {
        enabled: true,
        enabledAt: now,
        sourceFork: descriptor.fork,
      };
      await writeState(state);
      if (opts.json) {
        defaultRuntime.log(
          JSON.stringify(
            {
              ok: true,
              feature: descriptor.id,
              label: descriptor.label,
              fork: descriptor.fork,
              skill: descriptor.skill,
              statePath: statePath(),
            },
            null,
            2,
          ),
        );
        return;
      }
      defaultRuntime.log(`Enabled SP8 feature: ${descriptor.id}`);
      defaultRuntime.log(`Summary: ${descriptor.summary}`);
      defaultRuntime.log(`Fork: ${descriptor.fork}`);
      defaultRuntime.log(`Skill: openclaw skills info ${descriptor.skill}`);
      defaultRuntime.log(`ClawHub: npx clawhub search "${descriptor.clawhubHint}"`);
      defaultRuntime.log(`State file: ${statePath()}`);
    });
  feature
    .command("list")
    .description("List available SP8 features")
    .action(() => {
      defaultRuntime.log(featureList());
    });
}

function registerRouterCommands(sp8: Command) {
  const router = sp8.command("router").description("Sp8Router model routing");
  router
    .command("status")
    .description("Show free-model queue status")
    .option("--refresh", "Force model refresh", false)
    .option("--history", "Show model health history", false)
    .option("--airgap", "Block external model catalog calls", false)
    .action(async (opts) => {
      const instance = new Sp8Router({ airgap: Boolean(opts.airgap) });
      await instance.initialize();
      const includeHistory = Boolean(opts.history);
      const status = instance.getStatus({ history: includeHistory });
      defaultRuntime.log(JSON.stringify(status, null, 2));
      if (includeHistory && Array.isArray(status.history) && status.history.length > 0) {
        const rows = status.history.map((entry) => ({
          model: entry.id,
          success: `${Math.round(entry.successRate * 100)}%`,
          latency: `${Math.round(entry.avgLatencyMs)}ms`,
          rl429: `${Math.round(entry.rate429Frequency * 100)}%`,
          cooldown: entry.cooldownUntilMs ? new Date(entry.cooldownUntilMs).toISOString() : "-",
        }));
        defaultRuntime.log(
          renderTable({
            border: "unicode",
            columns: [
              { key: "model", header: "Model", minWidth: 30 },
              { key: "success", header: "Success", align: "right" },
              { key: "latency", header: "Avg Latency", align: "right" },
              { key: "rl429", header: "429 Rate", align: "right" },
              { key: "cooldown", header: "Cooldown" },
            ],
            rows,
          }),
        );
      }
    });
}

function registerOnboardCommand(sp8: Command) {
  sp8
    .command("onboard")
    .description("Set up Sp8Claw free-first profile with local model recommendations")
    .option("--free-first", "Configure free-first defaults", false)
    .option("--airgap", "Generate a strict local-only airgap profile", false)
    .option("--json", "Output machine-readable onboarding plan", false)
    .action(async (opts) => {
      if (!opts.freeFirst) {
        defaultRuntime.log("Tip: run sp8 onboard --free-first to apply the free-first profile.");
        return;
      }
      const hardware = {
        ramGb: Math.floor(os.totalmem() / 1024 / 1024 / 1024),
        cpuCount: os.cpus().length,
      };
      const runtimes = {
        ollama: hasBinary("ollama"),
        llamaCpp: hasBinary("llama-server") || hasBinary("llama-cli"),
        vllm: hasBinary("vllm"),
      };
      const profile = recommendLocalProfile(hardware);
      const plan = buildFreeFirstPlan({
        hardware,
        runtimes,
        profile: opts.airgap ? "zero-cloud" : profile,
        airgap: Boolean(opts.airgap),
      });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(plan, null, 2));
        return;
      }
      defaultRuntime.log(`Profile: ${plan.profile}`);
      defaultRuntime.log(`Hardware: ${hardware.ramGb} GB RAM / ${hardware.cpuCount} cores`);
      defaultRuntime.log(`Primary local model: ${plan.local.primaryModel}`);
      defaultRuntime.log(`Vision model: ${plan.local.visionModel}`);
      defaultRuntime.log(`Tool model: ${plan.local.toolModel}`);
      defaultRuntime.log(`Cloud fallback: ${plan.cloudFallback.join(", ")}`);
      for (const line of plan.nextSteps) {
        defaultRuntime.log(`- ${line}`);
      }
    });
}

function registerSwarmCommand(sp8: Command) {
  sp8
    .command("swarm")
    .description("Spawn 8 specialized Sp8 agents")
    .option("--goal <text>", "Swarm objective", "Complete the current task reliably")
    .action((opts) => {
      defaultRuntime.log(JSON.stringify(createSp8Swarm(String(opts.goal)), null, 2));
    });
}

function registerAntigravityCommand(sp8: Command) {
  sp8
    .command("antigravity")
    .description("Open Antigravity on a project path")
    .argument("<project-path>", "Project path")
    .option("--binary <bin>", "Antigravity executable name/path", "antigravity")
    .action((projectPath: string, opts) => {
      launchAntigravityProject(projectPath, { binary: String(opts.binary) });
      defaultRuntime.log(`Launched Antigravity for ${projectPath}`);
    });
}

function registerEvolveCommands(sp8: Command) {
  const evolve = sp8
    .command("evolve")
    .description("Self-evolution feedback and agentic self-improvement");

  evolve
    .command("signal")
    .description("Record a self-evolution feedback signal")
    .requiredOption("--signal <text>", "Feedback signal")
    .option("--delta <n>", "Score delta", "1")
    .action(async (opts) => {
      const delta = Number(opts.delta);
      const result = await appendEvolutionSignal(
        String(opts.signal),
        Number.isFinite(delta) ? delta : 1,
      );
      defaultRuntime.log(`Evolution score: ${result.total}`);
    });

  evolve
    .command("full")
    .description("Run agentic self-improvement loop (v1-v5 variants)")
    .option("--mode <mode>", "Improvement variant: v1|v2|v3|v4|v5", "v3")
    .option("--interactions <n>", "Max recent interactions to use", "50")
    .option("--candidates <n>", "Number of candidates to generate", "4")
    .option("--comparisons <n>", "Past hard tasks for comparison", "3")
    .option("--auto-apply", "Auto-apply winning patch (skips user veto)", false)
    .option("--population <n>", "Population size for v4 evolutionary search", "8")
    .option("--reflection-iters <n>", "Max iterations for v2 reflexion", "3")
    .option("--judge-model <model>", "Judge model for v3")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const mode = (
        ["v1", "v2", "v3", "v4", "v5"].includes(opts.mode) ? opts.mode : "v3"
      ) as EvolveMode;
      const result = await evolveSelf({
        mode,
        interactionLimit: Number(opts.interactions) || 50,
        candidateCount: Number(opts.candidates) || 4,
        comparisonTaskCount: Number(opts.comparisons) || 3,
        autoApply: Boolean(opts.autoApply),
        populationSize: Number(opts.population) || 8,
        maxReflectionIterations: Number(opts.reflectionIters) || 3,
        judgeModel: opts.judgeModel as string | undefined,
      });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(result, null, 2));
        return;
      }
      defaultRuntime.log(`Mode: ${result.mode}`);
      defaultRuntime.log(`Candidates evaluated: ${result.candidatesEvaluated}`);
      defaultRuntime.log(`Total evolution score: ${result.totalScore}`);
      if (result.winner) {
        defaultRuntime.log(`\nWinner: ${result.winner.id}`);
        defaultRuntime.log(`Description: ${result.winner.description}`);
        defaultRuntime.log(`Win rate: ${Math.round(result.winner.winRate * 100)}%`);
        defaultRuntime.log(`Score: ${Math.round(result.winner.score * 100)}%`);
        defaultRuntime.log(`Applied: ${result.applied ? "yes" : "no (use --auto-apply)"}`);
        if (result.comparison.length > 0) {
          defaultRuntime.log(`\nBefore/After comparison:`);
          defaultRuntime.log(
            renderTable({
              border: "unicode",
              columns: [
                { key: "task", header: "Task", minWidth: 30 },
                { key: "before", header: "Before", align: "right" },
                { key: "after", header: "After", align: "right" },
                { key: "delta", header: "Delta", align: "right" },
              ],
              rows: result.comparison.map((c) => ({
                task: c.taskSummary.slice(0, 60),
                before: `${Math.round(c.beforeScore * 100)}%`,
                after: `${Math.round(c.afterScore * 100)}%`,
                delta: `${c.delta >= 0 ? "+" : ""}${Math.round(c.delta * 100)}%`,
              })),
            }),
          );
        }
      } else {
        defaultRuntime.log("No interactions found - record some tasks first.");
      }
    });

  evolve
    .command("report")
    .description("Show self-improvement metrics and win-rate-over-time")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const report = await evolveReport();
      const metrics = await generateMetrics();
      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ evolve: report, metrics }, null, 2));
        return;
      }
      defaultRuntime.log(`Total evolution runs: ${report.totalRuns}`);
      defaultRuntime.log(`Average win rate: ${Math.round(report.avgWinRate * 100)}%`);
      defaultRuntime.log(
        `Average score delta: ${report.avgScoreDelta >= 0 ? "+" : ""}${Math.round(report.avgScoreDelta * 100)}%`,
      );
      defaultRuntime.log(`\nMode breakdown:`);
      for (const [mode, count] of Object.entries(report.modeBreakdown)) {
        if (count > 0) {
          defaultRuntime.log(`  ${mode}: ${count} runs`);
        }
      }
      if (report.recentWinners.length > 0) {
        defaultRuntime.log(`\nRecent winners:`);
        for (const w of report.recentWinners) {
          defaultRuntime.log(
            `  [${w.at.slice(0, 10)}] ${w.mode}: ${w.description.slice(0, 60)} (${Math.round(w.winRate * 100)}%)`,
          );
        }
      }
      const chartData = report.recentWinners.map((w) => ({
        label: w.at.slice(5, 10),
        value: w.winRate,
      }));
      if (chartData.length > 0) {
        defaultRuntime.log("");
        defaultRuntime.log(renderWinRateChart(chartData));
      }
      defaultRuntime.log(`\nRouting health:`);
      defaultRuntime.log(`  Models tracked: ${metrics.health.totalModelsTracked}`);
      defaultRuntime.log(`  On cooldown: ${metrics.health.modelsOnCooldown}`);
      defaultRuntime.log(`  Avg success rate: ${Math.round(metrics.health.avgSuccessRate * 100)}%`);
    });

  evolve
    .command("record")
    .description("Record a task interaction for self-improvement training data")
    .requiredOption("--task <text>", "Task description")
    .requiredOption("--result <text>", "Task result")
    .option("--feedback <text>", "User feedback")
    .option("--score <n>", "Score (0-1)")
    .action(async (opts) => {
      await recordInteraction({
        at: new Date().toISOString(),
        task: String(opts.task),
        result: String(opts.result),
        feedback: opts.feedback as string | undefined,
        score: opts.score !== undefined ? Number(opts.score) : undefined,
      });
      defaultRuntime.log("Interaction recorded.");
    });
}

function registerModelsCommands(sp8: Command) {
  const models = sp8.command("models").description("Agentic free model discovery and auto-config");

  models
    .command("hunt")
    .description("Discover, shadow-test, and promote free models")
    .option(
      "--focus <area>",
      "Focus: agent-tool-use|reasoning|coding|speed|vision|general",
      "agent-tool-use",
    )
    .option("--max-candidates <n>", "Max candidates to evaluate", "8")
    .option("--shadow-tests <n>", "Shadow-test tasks per model", "20")
    .option("--airgap", "Skip network calls", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const focus = opts.focus as
        | "agent-tool-use"
        | "reasoning"
        | "coding"
        | "speed"
        | "vision"
        | "general";
      const result = await huntModels({
        focus,
        maxCandidates: Number(opts.maxCandidates) || 8,
        shadowTestCount: Number(opts.shadowTests) || 20,
        airgap: Boolean(opts.airgap),
      });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(result, null, 2));
        return;
      }
      defaultRuntime.log(`Discovered: ${result.candidatesFound} free models`);
      defaultRuntime.log(`Filtered to top: ${result.candidatesFiltered}`);
      if (result.topCandidates.length > 0) {
        defaultRuntime.log("\nTop candidates:");
        defaultRuntime.log(
          renderTable({
            border: "unicode",
            columns: [
              { key: "model", header: "Model", minWidth: 35 },
              { key: "agent", header: "Agent", align: "right" },
              { key: "reasoning", header: "Reason", align: "right" },
              { key: "speed", header: "Speed", align: "right" },
              { key: "ctx", header: "Context", align: "right" },
              { key: "overall", header: "Overall", align: "right" },
            ],
            rows: result.topCandidates.slice(0, 8).map((c) => ({
              model: c.id,
              agent: String(c.agentToolScore),
              reasoning: String(c.reasoningScore),
              speed: String(c.speedScore),
              ctx: c.contextLength > 0 ? `${Math.round(c.contextLength / 1000)}k` : "?",
              overall: String(c.overallScore),
            })),
          }),
        );
      }
      if (result.shadowResults.length > 0) {
        defaultRuntime.log("\nShadow-test results:");
        defaultRuntime.log(
          renderTable({
            border: "unicode",
            columns: [
              { key: "model", header: "Model", minWidth: 35 },
              { key: "tasks", header: "Tasks", align: "right" },
              { key: "toolAcc", header: "Tool Acc", align: "right" },
              { key: "quality", header: "Quality", align: "right" },
              { key: "winRate", header: "Win Rate", align: "right" },
              { key: "avgMs", header: "Avg Ms", align: "right" },
            ],
            rows: result.shadowResults.map((s) => ({
              model: s.modelId,
              tasks: String(s.tasksRun),
              toolAcc: `${Math.round(s.toolCallAccuracy * 100)}%`,
              quality: `${Math.round(s.answerQuality * 100)}%`,
              winRate: `${Math.round(s.winRate * 100)}%`,
              avgMs: `${s.avgTimeMs}ms`,
            })),
          }),
        );
      }
      if (result.promoted.length > 0) {
        defaultRuntime.log(`\nPromoted: ${result.promoted.join(", ")}`);
      } else {
        defaultRuntime.log("\nNo models met promotion threshold.");
      }
    });

  models
    .command("status")
    .description("Show current routing weights and shadow-test win rates")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const status = await getModelStatus();
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(status, null, 2));
        return;
      }
      if (status.promotions.length === 0) {
        defaultRuntime.log(
          "No model promotions yet. Run 'sp8 models hunt' to discover and promote.",
        );
        return;
      }
      defaultRuntime.log("Task-class routing:");
      for (const [tc, r] of Object.entries(status.taskClassRouting)) {
        defaultRuntime.log(`  ${tc}: ${r.modelId} (${Math.round(r.winRate * 100)}% win rate)`);
      }
      defaultRuntime.log(`\nTotal promotions: ${status.promotions.length}`);
    });

  models
    .command("shadow-history")
    .description("Show shadow-test history")
    .option("--limit <n>", "Max entries", "10")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const history = await loadShadowHistory();
      const limited = history.slice(-(Number(opts.limit) || 10));
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(limited, null, 2));
        return;
      }
      if (limited.length === 0) {
        defaultRuntime.log("No shadow-test history. Run 'sp8 models hunt' first.");
        return;
      }
      defaultRuntime.log(
        renderTable({
          border: "unicode",
          columns: [
            { key: "model", header: "Model", minWidth: 35 },
            { key: "tested", header: "Tested", minWidth: 16 },
            { key: "winRate", header: "Win Rate", align: "right" },
            { key: "quality", header: "Quality", align: "right" },
            { key: "toolAcc", header: "Tool Acc", align: "right" },
          ],
          rows: limited.map((s) => ({
            model: s.modelId,
            tested: s.testedAt?.slice(0, 16) ?? "?",
            winRate: `${Math.round(s.winRate * 100)}%`,
            quality: `${Math.round(s.answerQuality * 100)}%`,
            toolAcc: `${Math.round(s.toolCallAccuracy * 100)}%`,
          })),
        }),
      );
    });
}

function registerIntakeCommands(sp8: Command) {
  const intake = sp8.command("intake").description("Collect SP8 MCP/skills/SOUL/prompt sources");
  intake
    .command("sync")
    .description("Collect and store local + curated external intake records")
    .option("--workspace-root <path>", "Workspace root to scan", process.cwd())
    .option("--output-dir <path>", "Custom intake output directory")
    .action(async (opts) => {
      const result = await syncSp8Intake({
        workspaceRoot: String(opts.workspaceRoot),
        outputDir: (opts.outputDir as string | undefined)?.trim() || undefined,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    });
}

function registerMcpCommands(sp8: Command) {
  const mcp = sp8.command("mcp").description("Manage Sp8 MCP servers");
  mcp
    .command("add")
    .description("Add a user-defined MCP server")
    .requiredOption("--name <name>", "Server name")
    .requiredOption("--command <command>", "Server command")
    .option("--args <arg...>", "Server arguments")
    .action(async (opts) => {
      const config = await addSp8McpServer({
        server: {
          name: String(opts.name),
          command: String(opts.command),
          args: Array.isArray(opts.args) ? (opts.args as string[]) : [],
        },
      });
      defaultRuntime.log(JSON.stringify(config, null, 2));
    });
  mcp
    .command("list")
    .description("List configured MCP servers")
    .action(async () => {
      defaultRuntime.log(JSON.stringify(await readSp8McpConfig(), null, 2));
    });
  mcp
    .command("autowrap-skills")
    .description("Auto-wrap local skills as MCP server entries")
    .option("--skills-dir <path>", "Skills directory", "skills")
    .action(async (opts) => {
      defaultRuntime.log(
        JSON.stringify(
          await autoWrapSkillsAsMcpServers({ skillsDir: String(opts.skillsDir) }),
          null,
          2,
        ),
      );
    });
}

function registerGeminiCommands(sp8: Command) {
  const gemini = sp8.command("gemini").description("Gemini CLI + OAuth controls");
  gemini
    .command("oauth-start")
    .description("Generate Google OAuth PKCE URL for Gemini CLI")
    .requiredOption("--client-id <id>", "Google OAuth client id")
    .requiredOption("--redirect-uri <uri>", "OAuth redirect URI")
    .option("--scope <scope>", "OAuth scope", "openid email profile")
    .action(async (opts) => {
      const session = createGeminiPkceAuthSession({
        clientId: String(opts.clientId),
        redirectUri: String(opts.redirectUri),
        scope: String(opts.scope),
      });
      defaultRuntime.log(JSON.stringify(session, null, 2));
      defaultRuntime.log("Open authorizationUrl in a browser, then exchange the returned code.");
    });
  gemini
    .command("oauth-exchange")
    .description("Exchange OAuth code and persist tokens")
    .requiredOption("--client-id <id>", "Google OAuth client id")
    .requiredOption("--redirect-uri <uri>", "OAuth redirect URI")
    .requiredOption("--code <code>", "OAuth code")
    .requiredOption("--code-verifier <verifier>", "PKCE code verifier")
    .option("--client-secret <secret>", "OAuth client secret")
    .action(async (opts) => {
      const tokens = await exchangeGeminiOAuthCode({
        clientId: String(opts.clientId),
        clientSecret: opts.clientSecret as string | undefined,
        redirectUri: String(opts.redirectUri),
        code: String(opts.code),
        codeVerifier: String(opts.codeVerifier),
      });
      await storeGeminiOAuthTokens(tokens);
      defaultRuntime.log("Gemini OAuth tokens stored.");
    });
  gemini
    .command("oauth-status")
    .description("Show whether Gemini OAuth tokens are available")
    .action(async () => {
      const tokens = await loadGeminiOAuthTokens();
      if (!tokens) {
        defaultRuntime.log("No Gemini OAuth tokens found.");
        return;
      }
      defaultRuntime.log(
        JSON.stringify(
          {
            hasAccessToken: Boolean(tokens.accessToken),
            hasRefreshToken: Boolean(tokens.refreshToken),
            expiresAtMs: tokens.expiresAtMs,
            scope: tokens.scope,
          },
          null,
          2,
        ),
      );
    });
}
