import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

type Sp8Enhancement =
  | "antigravity-canvas-visuals"
  | "swarm-delegation"
  | "personal-kg-auto-indexing"
  | "style-mirror-adaptation"
  | "parallel-multimodal-fusion";

type TrustedSource = "steipete" | "mcp.so-official";

type TrustedSkill = {
  name: string;
  source: TrustedSource;
  summary: string;
  enhancements: Sp8Enhancement[];
};

type TrustedMcp = {
  name: string;
  source: TrustedSource;
  summary: string;
  mcporterTarget: string;
  args: string[];
  defaults?: Record<string, unknown>;
  enhancements: Sp8Enhancement[];
};

type VtReport = {
  clean?: boolean;
  stats?: {
    malicious?: number;
    suspicious?: number;
    harmless?: number;
    undetected?: number;
  };
};

type VettingResult = {
  vt: "verified" | "pending";
  vtSource?: string;
  sandboxProfile: string;
  consentAt: string;
};

type Sp8PowerPackState = {
  installedSkills: Record<
    string,
    {
      installedAt: string;
      source: TrustedSource;
      summary: string;
      enhancements: Sp8Enhancement[];
      vetting: VettingResult;
    }
  >;
  mcpServers: Record<
    string,
    {
      addedAt: string;
      source: TrustedSource;
      summary: string;
      wrapper: "mcporter";
      target: string;
      args: string[];
      defaults?: Record<string, unknown>;
      enhancements: Sp8Enhancement[];
      vetting: VettingResult;
    }
  >;
};

const DEFAULT_ENHANCEMENTS: Sp8Enhancement[] = [
  "antigravity-canvas-visuals",
  "swarm-delegation",
  "personal-kg-auto-indexing",
  "style-mirror-adaptation",
  "parallel-multimodal-fusion",
];

const TRUSTED_SKILLS: readonly TrustedSkill[] = [
  {
    name: "pluginforge",
    source: "steipete",
    summary: "Generate Max/MSP, VST, and WebAudio patches with UVT auto-load + audition.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "stemuvt",
    source: "steipete",
    summary: "Route stem separation through your local UVT install with autoload workflows.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "sampleoracle",
    source: "steipete",
    summary: "Intelligent sample discovery across local folders and UVT soundbanks.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "setforge",
    source: "steipete",
    summary: "DJ set builder with harmonic compatibility and crowd-energy arc planning.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "chorddreamer",
    source: "steipete",
    summary: "Style-exact generative chords/melodies with UVT preset export.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "liveguard",
    source: "steipete",
    summary: "Real-time performance co-pilot for latency, clipping, and transition safety.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "mixshadow",
    source: "steipete",
    summary: "Visual mix analysis with targeted production fixes and stage-safe suggestions.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "memogravity",
    source: "steipete",
    summary: "Voice/text memo to playable assets + UVT load in one local pass.",
    enhancements: DEFAULT_ENHANCEMENTS,
  },
];

const TRUSTED_MCPS: readonly TrustedMcp[] = [
  {
    name: "mcporter",
    source: "mcp.so-official",
    summary: "Universal MCP wrapper + lifecycle manager.",
    mcporterTarget: "mcporter",
    args: ["server", "mcporter"],
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "playwright",
    source: "mcp.so-official",
    summary: "Browser automation via Playwright/Puppeteer.",
    mcporterTarget: "playwright",
    args: ["server", "playwright"],
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "postgresql-readonly",
    source: "mcp.so-official",
    summary: "PostgreSQL queries with explicit read-only posture.",
    mcporterTarget: "postgresql",
    args: ["server", "postgresql", "--readonly"],
    defaults: { readonly: true },
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "redis",
    source: "mcp.so-official",
    summary: "Redis data access and cache instrumentation.",
    mcporterTarget: "redis",
    args: ["server", "redis"],
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "filesystem-scoped",
    source: "mcp.so-official",
    summary: "Filesystem MCP constrained to approved workspace roots.",
    mcporterTarget: "filesystem",
    args: ["server", "filesystem", "--scoped"],
    defaults: { scoped: true },
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "linear",
    source: "mcp.so-official",
    summary: "Linear ticket automation.",
    mcporterTarget: "linear",
    args: ["server", "linear"],
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "jira",
    source: "mcp.so-official",
    summary: "Jira issue operations and workflow support.",
    mcporterTarget: "jira",
    args: ["server", "jira"],
    enhancements: DEFAULT_ENHANCEMENTS,
  },
  {
    name: "github-mcp",
    source: "mcp.so-official",
    summary: "GitHub MCP integrations for repos, issues, and PRs.",
    mcporterTarget: "github",
    args: ["server", "github"],
    enhancements: DEFAULT_ENHANCEMENTS,
  },
];

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function resolveSp8StateDir(stateDir?: string): string {
  return path.join(stateDir ?? resolveStateDir(), "sp8");
}

function resolveStatePath(stateDir?: string): string {
  return path.join(resolveSp8StateDir(stateDir), "power-pack.json");
}

function resolveMcpConfigPath(stateDir?: string): string {
  return path.join(resolveSp8StateDir(stateDir), "mcp-servers.json");
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | undefined> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text) as T;
  } catch (err) {
    const message = String(err);
    if (message.includes("ENOENT")) {
      return undefined;
    }
    throw err;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function loadState(stateDir?: string): Promise<Sp8PowerPackState> {
  const existing = await readJsonIfPresent<Sp8PowerPackState>(resolveStatePath(stateDir));
  if (existing) {
    return existing;
  }
  return {
    installedSkills: {},
    mcpServers: {},
  };
}

function assertConsent(consent: boolean): void {
  if (!consent) {
    throw new Error("Safe mode requires explicit consent. Re-run with --consent.");
  }
}

function assertSandboxProfile(profile: string): void {
  if (profile !== "strict") {
    throw new Error('Safe mode requires sandbox profile "strict". Use --sandbox-profile strict.');
  }
}

async function validateVirusTotalReport(
  vtReportPath?: string,
): Promise<{ vt: "verified" | "pending"; vtSource?: string }> {
  if (!vtReportPath) {
    return { vt: "pending" };
  }
  const report = await readJsonIfPresent<VtReport>(vtReportPath);
  if (!report) {
    throw new Error(`VirusTotal report not found: ${vtReportPath}`);
  }
  if (report.clean === true) {
    return { vt: "verified", vtSource: vtReportPath };
  }
  const malicious = report.stats?.malicious ?? 0;
  const suspicious = report.stats?.suspicious ?? 0;
  if (malicious === 0 && suspicious === 0) {
    return { vt: "verified", vtSource: vtReportPath };
  }
  throw new Error("VirusTotal report indicates suspicious or malicious detections.");
}

function resolveTrustedSkill(name: string): TrustedSkill | undefined {
  const target = normalizeName(name);
  return TRUSTED_SKILLS.find((entry) => normalizeName(entry.name) === target);
}

function resolveTrustedMcp(name: string): TrustedMcp | undefined {
  const target = normalizeName(name);
  return TRUSTED_MCPS.find((entry) => normalizeName(entry.name) === target);
}

function sourceLabel(source: TrustedSource): string {
  return source === "steipete" ? "@steipete" : "mcp.so official";
}

export function getTrustedSkillCatalog(): readonly TrustedSkill[] {
  return TRUSTED_SKILLS;
}

export function getTrustedMcpCatalog(): readonly TrustedMcp[] {
  return TRUSTED_MCPS;
}

export async function installSp8SkillSafe(params: {
  name: string;
  safe: boolean;
  consent: boolean;
  sandboxProfile: string;
  vtReportPath?: string;
  stateDir?: string;
}): Promise<{ message: string; statePath: string }> {
  if (!params.safe) {
    throw new Error("Only --safe installs are allowed for Sp8 skills.");
  }
  assertConsent(params.consent);
  assertSandboxProfile(params.sandboxProfile);

  const skill = resolveTrustedSkill(params.name);
  if (!skill) {
    throw new Error(`Skill "${params.name}" is not in the vetted Sp8 allowlist.`);
  }

  const vt = await validateVirusTotalReport(params.vtReportPath);
  const state = await loadState(params.stateDir);
  const now = new Date().toISOString();
  state.installedSkills[skill.name] = {
    installedAt: now,
    source: skill.source,
    summary: skill.summary,
    enhancements: skill.enhancements,
    vetting: {
      ...vt,
      sandboxProfile: params.sandboxProfile,
      consentAt: now,
    },
  };
  const statePath = resolveStatePath(params.stateDir);
  await writeJson(statePath, state);

  return {
    message: `Installed safe skill "${skill.name}" from ${sourceLabel(skill.source)} (VT: ${vt.vt}).`,
    statePath,
  };
}

export async function addSp8Mcp(params: {
  name: string;
  consent: boolean;
  sandboxProfile: string;
  vtReportPath?: string;
  stateDir?: string;
}): Promise<{ message: string; statePath: string; mcpConfigPath: string }> {
  assertConsent(params.consent);
  assertSandboxProfile(params.sandboxProfile);

  const mcp = resolveTrustedMcp(params.name);
  if (!mcp) {
    throw new Error(`MCP server "${params.name}" is not in the vetted Sp8 allowlist.`);
  }

  const vt = await validateVirusTotalReport(params.vtReportPath);
  const now = new Date().toISOString();

  const state = await loadState(params.stateDir);
  state.mcpServers[mcp.name] = {
    addedAt: now,
    source: mcp.source,
    summary: mcp.summary,
    wrapper: "mcporter",
    target: mcp.mcporterTarget,
    args: mcp.args,
    defaults: mcp.defaults,
    enhancements: mcp.enhancements,
    vetting: {
      ...vt,
      sandboxProfile: params.sandboxProfile,
      consentAt: now,
    },
  };
  const statePath = resolveStatePath(params.stateDir);
  await writeJson(statePath, state);

  const mcpConfigPath = resolveMcpConfigPath(params.stateDir);
  const existing =
    (await readJsonIfPresent<{ mcpServers?: Record<string, unknown> }>(mcpConfigPath)) ?? {};
  const mcpServers = { ...existing.mcpServers };
  mcpServers[mcp.name] = {
    command: "mcporter",
    args: ["run", mcp.mcporterTarget, ...mcp.args],
    source: sourceLabel(mcp.source),
    wrapper: "mcporter",
    sp8Enhancements: mcp.enhancements,
    vetting: {
      ...vt,
      sandboxProfile: params.sandboxProfile,
      consentAt: now,
    },
    ...(mcp.defaults ? { defaults: mcp.defaults } : {}),
  };
  await writeJson(mcpConfigPath, { mcpServers });

  return {
    message: `Added MCP "${mcp.name}" via mcporter from ${sourceLabel(mcp.source)} (VT: ${vt.vt}).`,
    statePath,
    mcpConfigPath,
  };
}
