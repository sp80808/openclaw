import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommandWithTimeout } from "../../../../src/process/exec.js";
import type { UvtBridgeContext } from "../types.js";

type AutoLoadRequest = {
  assetPath: string;
  presetName?: string;
  auditionMs?: number;
};

function candidateBinaryPaths(): string[] {
  const home = os.homedir();
  const localBin = path.join(home, ".local", "bin");
  const pnpmBin = path.join(home, "Library", "pnpm");
  return [
    process.env.UVT_CLI_PATH?.trim() ?? "",
    "uvt",
    path.join(localBin, "uvt"),
    path.join(localBin, "uvt-cli"),
    path.join(pnpmBin, "uvt"),
    "/usr/local/bin/uvt",
    "/opt/homebrew/bin/uvt",
  ].filter(Boolean);
}

function candidateRootPaths(): string[] {
  const home = os.homedir();
  return [
    process.env.UVT_HOME?.trim() ?? "",
    path.join(home, "UVT"),
    path.join(home, ".uvt"),
    path.join(home, "Library", "Application Support", "UVT"),
  ].filter(Boolean);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUvtBinary(): Promise<string> {
  for (const candidate of candidateBinaryPaths()) {
    if (candidate === "uvt") {
      const probe = await runCommandWithTimeout(["uvt", "--version"], { timeoutMs: 4_000 });
      if (probe.code === 0) {
        return "uvt";
      }
      continue;
    }
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("UVT CLI not found. Set UVT_CLI_PATH or install `uvt` on PATH.");
}

async function resolveUvtRoot(): Promise<string> {
  for (const candidate of candidateRootPaths()) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("UVT install root not found. Set UVT_HOME to your local UVT directory.");
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function detectUvtInstall(): Promise<UvtBridgeContext> {
  const [uvtCliPath, uvtRootDir] = await Promise.all([resolveUvtBinary(), resolveUvtRoot()]);
  const presetsDir = path.join(uvtRootDir, "presets");
  const soundbanksDir = path.join(uvtRootDir, "soundbanks");
  const dropsDir = path.join(uvtRootDir, "autoload", "drops");
  await Promise.all([ensureDir(presetsDir), ensureDir(soundbanksDir), ensureDir(dropsDir)]);
  return {
    uvtCliPath,
    uvtRootDir,
    presetsDir,
    soundbanksDir,
    dropsDir,
  };
}

export async function runUvtCli(
  context: UvtBridgeContext,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return runCommandWithTimeout([context.uvtCliPath, ...args], {
    timeoutMs,
    env: {
      ...process.env,
      UVT_HOME: context.uvtRootDir,
    },
  });
}

export async function dropAssetForUvtAutoLoad(
  context: UvtBridgeContext,
  request: AutoLoadRequest,
): Promise<string> {
  const source = path.resolve(request.assetPath);
  if (!(await pathExists(source))) {
    throw new Error(`UVT autoload asset not found: ${source}`);
  }
  const name = path.basename(source);
  const target = path.join(context.dropsDir, name);
  await fs.copyFile(source, target);
  const manifestPath = `${target}.json`;
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        source,
        target,
        presetName: request.presetName,
        auditionMs: request.auditionMs ?? 8000,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return target;
}

export async function exportUvtPreset(
  context: UvtBridgeContext,
  presetName: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const safeName = presetName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const target = path.join(context.presetsDir, `${safeName}.json`);
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return target;
}

export async function auditionInUvt(
  context: UvtBridgeContext,
  assetPath: string,
  durationMs = 8_000,
): Promise<void> {
  const result = await runUvtCli(
    context,
    ["session", "audition", "--asset", assetPath, "--duration-ms", String(durationMs)],
    Math.max(30_000, durationMs + 8_000),
  );
  if (result.code !== 0) {
    throw new Error(`UVT audition failed: ${result.stderr || result.stdout}`);
  }
}
