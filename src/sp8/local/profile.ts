import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectBinary } from "../../commands/onboard-helpers.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { resolveUserPath } from "../../utils.js";

export type Sp8RoutingChoice = "free-first-hybrid" | "full-local" | "zero-cloud-airgap";

export type Sp8HardwareProfile = {
  cpu: string;
  cpuCores: number;
  ramGb: number;
  gpu: string;
  gpuMemoryGb: number | null;
  capabilityClass: string;
  profileLabel: string;
};

export type Sp8RecommendedModel = {
  role: string;
  model: string;
  quantization: string;
  memoryHint: string;
  ollamaTag?: string;
};

export type Sp8LocalRecommendation = {
  headline: string;
  models: Sp8RecommendedModel[];
};

export type Sp8Profile = {
  version: 1;
  routing: Sp8RoutingChoice;
  localEnabled: boolean;
  hardware?: Sp8HardwareProfile;
  recommendations?: Sp8RecommendedModel[];
  createdAt: string;
  updatedAt: string;
};

const SP8_PROFILE_PATH = "~/.openclaw/sp8-profile.json";

function roundGb(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024 / 1024 / 1024));
}

function normalizeModelToken(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function detectAppleProfileLabel(cpu: string, ramGb: number): string {
  const match = cpu.match(/\bM\d(?:\s+(?:Pro|Max|Ultra))?\b/i);
  if (!match) {
    return `local-${ramGb}gb`;
  }
  return `${normalizeModelToken(match[0])}-${ramGb}gb`;
}

function classifyCapability(params: {
  ramGb: number;
  cpuCores: number;
  gpuMemoryGb: number | null;
  gpuLabel: string;
}): string {
  const { ramGb, cpuCores, gpuMemoryGb, gpuLabel } = params;
  const isAppleUnified = gpuLabel.toLowerCase().includes("apple silicon");
  if (isAppleUnified && ramGb >= 64) {
    return "Perfect for 32B-72B class models";
  }
  if ((gpuMemoryGb ?? 0) >= 24 || ramGb >= 64) {
    return "Strong fit for 32B class local models";
  }
  if ((gpuMemoryGb ?? 0) >= 12 || ramGb >= 16 || cpuCores >= 8) {
    return "Great fit for 7B-14B local models";
  }
  return "Best with compact 0.6B-7B local models";
}

async function detectGpu(): Promise<{ label: string; memoryGb: number | null }> {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      label: "Apple Silicon (Unified)",
      memoryGb: null,
    };
  }

  const hasNvidiaSmi = await detectBinary("nvidia-smi");
  if (hasNvidiaSmi) {
    const result = await runCommandWithTimeout(
      ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
      { timeoutMs: 3_000 },
    );
    if (result.code === 0) {
      const first = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (first) {
        const [namePart, memoryPart] = first.split(",").map((part) => part.trim());
        const memoryMatch = memoryPart?.match(/(\d+)/);
        const memoryMb = memoryMatch ? Number.parseInt(memoryMatch[1], 10) : Number.NaN;
        const memoryGb = Number.isFinite(memoryMb)
          ? Math.max(1, Math.round(memoryMb / 1024))
          : null;
        return {
          label: namePart || "NVIDIA GPU",
          memoryGb,
        };
      }
    }
  }

  if (process.platform === "linux" && (await detectBinary("lspci"))) {
    const result = await runCommandWithTimeout(["lspci"], { timeoutMs: 2_000 });
    if (result.code === 0) {
      const line = result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => /vga|3d controller|display controller/i.test(entry));
      if (line) {
        const label = line.replace(/^\S+\s+/, "").trim();
        return { label, memoryGb: null };
      }
    }
  }

  return { label: "GPU not detected", memoryGb: null };
}

function chooseRecommendations(hardware: Sp8HardwareProfile): Sp8LocalRecommendation {
  const lowerClass = hardware.capabilityClass.toLowerCase();
  const highTier = lowerClass.includes("32b") || lowerClass.includes("72b");
  const mediumTier = lowerClass.includes("7b-14b");

  if (highTier) {
    return {
      headline: "Recommended stack for you:",
      models: [
        {
          role: "Primary reasoning",
          model: "Qwen3-Coder-Next 32B",
          quantization: "Q5_K_M",
          memoryHint: "~24 GB VRAM-equivalent",
          ollamaTag: "qwen3-coder-next:32b",
        },
        {
          role: "Fast daily driver",
          model: "Qwen3 14B",
          quantization: "IQ4_XS",
          memoryHint: "~10 GB",
          ollamaTag: "qwen3:14b",
        },
        {
          role: "Vision",
          model: "Qwen3-VL 7B",
          quantization: "Q4_K_M",
          memoryHint: "~6 GB",
          ollamaTag: "qwen3-vl:7b",
        },
        {
          role: "Voice",
          model: "Whisper.cpp large-v3 + Piper TTS",
          quantization: "offline",
          memoryHint: "CPU/NE optimized",
        },
      ],
    };
  }

  if (mediumTier) {
    return {
      headline: "Recommended stack for you:",
      models: [
        {
          role: "Primary reasoning",
          model: "Qwen3-Coder-Next 7B",
          quantization: "IQ4_XS",
          memoryHint: "~6 GB",
          ollamaTag: "qwen3-coder-next:7b",
        },
        {
          role: "Fast daily driver",
          model: "Gemma3 2B",
          quantization: "Q4_K_M",
          memoryHint: "~2 GB",
          ollamaTag: "gemma3:2b",
        },
        {
          role: "Vision",
          model: "Qwen3-VL 3B",
          quantization: "Q4_K_M",
          memoryHint: "~3 GB",
          ollamaTag: "qwen3-vl:3b",
        },
      ],
    };
  }

  return {
    headline: "Recommended stack for you:",
    models: [
      {
        role: "Primary reasoning",
        model: "Qwen3 0.6B",
        quantization: "Q4_K_M",
        memoryHint: "~1 GB",
        ollamaTag: "qwen3:0.6b",
      },
      {
        role: "Daily driver",
        model: "Gemma3 2B",
        quantization: "Q4_K_M",
        memoryHint: "~2 GB",
        ollamaTag: "gemma3:2b",
      },
    ],
  };
}

export function resolveSp8ProfilePath(): string {
  return resolveUserPath(SP8_PROFILE_PATH);
}

export async function detectLocalHardwareProfile(): Promise<Sp8HardwareProfile> {
  const cpus = os.cpus();
  const cpu = cpus[0]?.model?.trim() || `${cpus.length || 1}-core CPU`;
  const cpuCores = cpus.length || 1;
  const ramGb = roundGb(os.totalmem());
  const gpu = await detectGpu();
  const profileLabel =
    process.platform === "darwin"
      ? detectAppleProfileLabel(cpu, ramGb)
      : `${normalizeModelToken(process.platform)}-${ramGb}gb`;

  return {
    cpu,
    cpuCores,
    ramGb,
    gpu: gpu.label,
    gpuMemoryGb: gpu.memoryGb,
    capabilityClass: classifyCapability({
      ramGb,
      cpuCores,
      gpuMemoryGb: gpu.memoryGb,
      gpuLabel: gpu.label,
    }),
    profileLabel,
  };
}

export function buildLocalRecommendations(hardware: Sp8HardwareProfile): Sp8LocalRecommendation {
  return chooseRecommendations(hardware);
}

export async function readSp8Profile(
  pathname = resolveSp8ProfilePath(),
): Promise<Sp8Profile | null> {
  const raw = await fs.readFile(pathname, "utf8").catch(() => "");
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Sp8Profile;
    if (!parsed || parsed.version !== 1 || typeof parsed.routing !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSp8Profile(profile: Sp8Profile, pathname = resolveSp8ProfilePath()) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

export async function saveSp8Profile(params: {
  routing: Sp8RoutingChoice;
  localEnabled: boolean;
  hardware?: Sp8HardwareProfile;
  recommendations?: Sp8RecommendedModel[];
}) {
  const existing = await readSp8Profile();
  const now = new Date().toISOString();
  const profile: Sp8Profile = {
    version: 1,
    routing: params.routing,
    localEnabled: params.localEnabled,
    hardware: params.hardware,
    recommendations: params.recommendations,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeSp8Profile(profile);
  return profile;
}

export async function pullRecommendedOllamaModels(recommendation: Sp8LocalRecommendation): Promise<{
  ok: boolean;
  skippedReason?: string;
  pulled: string[];
  failed: string[];
}> {
  const tags = recommendation.models
    .map((entry) => entry.ollamaTag)
    .filter((tag): tag is string => Boolean(tag));

  if (tags.length === 0) {
    return { ok: true, pulled: [], failed: [] };
  }

  const hasOllama = await detectBinary("ollama");
  if (!hasOllama) {
    return {
      ok: false,
      skippedReason: "Ollama is not installed or not in PATH",
      pulled: [],
      failed: tags,
    };
  }

  const pulled: string[] = [];
  const failed: string[] = [];
  for (const tag of tags) {
    const result = await runCommandWithTimeout(["ollama", "pull", tag], { timeoutMs: 30 * 60_000 });
    if (result.code === 0) {
      pulled.push(tag);
    } else {
      failed.push(tag);
    }
  }

  return {
    ok: failed.length === 0,
    pulled,
    failed,
  };
}
