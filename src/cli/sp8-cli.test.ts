import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSp8Cli } from "./sp8-cli.js";

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

let configDir = "";

vi.mock("../runtime.js", () => ({
  defaultRuntime: runtime,
}));

vi.mock("../utils.js", () => ({
  get CONFIG_DIR() {
    return configDir;
  },
}));

describe("sp8 cli", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sp8-"));
  });

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
  });

  async function runCli(args: string[]) {
    const program = new Command();
    registerSp8Cli(program);
    await program.parseAsync(args, { from: "user" });
  }

  it("enables a known feature and writes state", async () => {
    await runCli(["sp8", "feature", "enable", "mcp-agent-teams"]);

    const statePath = path.join(configDir, "sp8", "features.json");
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as {
      features: Record<string, { enabled: boolean; sourceFork: string }>;
    };

    expect(parsed.features["mcp-agent-teams"]?.enabled).toBe(true);
    expect(parsed.features["mcp-agent-teams"]?.sourceFork).toContain("openclaw-claude-code-skill");
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("fails on unknown feature", async () => {
    await runCli(["sp8", "feature", "enable", "does-not-exist"]);

    expect(runtime.error).toHaveBeenCalled();
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
