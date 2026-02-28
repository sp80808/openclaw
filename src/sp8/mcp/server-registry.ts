import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../../utils.js";

export type Sp8McpServer = {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type Sp8McpConfig = {
  mcpServers: Record<string, Sp8McpServer>;
};

export function resolveSp8McpConfigPath(): string {
  return path.join(resolveUserPath("~/.openclaw/sp8"), "mcp-servers.json");
}

export async function readSp8McpConfig(
  configPath = resolveSp8McpConfigPath(),
): Promise<Sp8McpConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Sp8McpConfig;
    if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") {
      return { mcpServers: {} };
    }
    return parsed;
  } catch {
    return { mcpServers: {} };
  }
}

export async function writeSp8McpConfig(
  config: Sp8McpConfig,
  configPath = resolveSp8McpConfigPath(),
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function addSp8McpServer(params: {
  server: Sp8McpServer;
  configPath?: string;
}): Promise<Sp8McpConfig> {
  const config = await readSp8McpConfig(params.configPath);
  config.mcpServers[params.server.name] = params.server;
  await writeSp8McpConfig(config, params.configPath);
  return config;
}

export async function autoWrapSkillsAsMcpServers(params?: {
  skillsDir?: string;
  configPath?: string;
}): Promise<Sp8McpConfig> {
  const skillsDir = params?.skillsDir ?? path.resolve("skills");
  const config = await readSp8McpConfig(params?.configPath);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry);
    const marker = path.join(skillPath, "SKILL.md");
    try {
      await fs.access(marker);
      config.mcpServers[`skill-${entry}`] = {
        name: `skill-${entry}`,
        command: "openclaw",
        args: ["skills", "info", entry],
        cwd: process.cwd(),
      };
    } catch {
      // skip
    }
  }

  await writeSp8McpConfig(config, params?.configPath);
  return config;
}
