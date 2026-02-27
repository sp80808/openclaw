import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addSp8Mcp, installSp8SkillSafe } from "./sp8-power-pack.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sp8-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("sp8 power pack", () => {
  it("installs a trusted skill in safe mode", async () => {
    await withTempDir(async (stateDir) => {
      const vtPath = path.join(stateDir, "vt.json");
      await fs.writeFile(vtPath, JSON.stringify({ clean: true }), "utf-8");

      const result = await installSp8SkillSafe({
        name: "pluginforge",
        safe: true,
        consent: true,
        sandboxProfile: "strict",
        vtReportPath: vtPath,
        stateDir,
      });

      const state = JSON.parse(await fs.readFile(result.statePath, "utf-8")) as {
        installedSkills: Record<string, { source: string }>;
      };
      expect(state.installedSkills.pluginforge?.source).toBe("steipete");
    });
  });

  it("rejects unknown skills", async () => {
    await withTempDir(async (stateDir) => {
      await expect(
        installSp8SkillSafe({
          name: "unknown-skill",
          safe: true,
          consent: true,
          sandboxProfile: "strict",
          stateDir,
        }),
      ).rejects.toThrow(/not in the vetted Sp8 allowlist/i);
    });
  });

  it("adds a trusted mcp server", async () => {
    await withTempDir(async (stateDir) => {
      const vtPath = path.join(stateDir, "vt.json");
      await fs.writeFile(vtPath, JSON.stringify({ clean: true }), "utf-8");

      const result = await addSp8Mcp({
        name: "github-mcp",
        consent: true,
        sandboxProfile: "strict",
        vtReportPath: vtPath,
        stateDir,
      });

      const mcpConfig = JSON.parse(await fs.readFile(result.mcpConfigPath, "utf-8")) as {
        mcpServers: Record<string, { command: string }>;
      };
      expect(mcpConfig.mcpServers["github-mcp"]?.command).toBe("mcporter");
    });
  });
});
