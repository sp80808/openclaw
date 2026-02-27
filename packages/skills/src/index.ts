import { runChordDreamer } from "./chord-dreamer.js";
import { runLiveGuard } from "./live-guard.js";
import { runMemoGravity } from "./memo-gravity.js";
import { runMixShadow } from "./mix-shadow.js";
import { runPluginForge } from "./pluginforge.js";
import { runSampleOracle } from "./sample-oracle.js";
import { runSetForge } from "./set-forge.js";
import { runStemUVT } from "./stem-uvt.js";
import type { SkillExecutionContext, SkillExecutionResult, SkillName } from "./types.js";

export type SkillRegistryEntry = {
  name: SkillName;
  summary: string;
  starFeature?: boolean;
};

export const MUSIC_SKILL_REGISTRY: readonly SkillRegistryEntry[] = [
  {
    name: "PluginForge",
    summary: "Generate Max/MSP, VST, and WebAudio patches with UVT auto-audition.",
    starFeature: true,
  },
  {
    name: "StemUVT",
    summary: "Run stem separation through local UVT and route outputs back into your session.",
  },
  {
    name: "SampleOracle",
    summary: "Search local sample pools + UVT soundbanks with style-aware ranking.",
  },
  {
    name: "SetForge",
    summary: "Build DJ sets around harmonic flow and energy arcs.",
  },
  {
    name: "ChordDreamer",
    summary: "Generate style-exact chord/melody ideas and export UVT presets.",
  },
  {
    name: "LiveGuard",
    summary: "Realtime performance copilot for latency, clipping, and crowd energy.",
  },
  {
    name: "MixShadow",
    summary: "Visual mix diagnostics with concise production suggestions.",
  },
  {
    name: "MemoGravity",
    summary: "Voice/text memo capture into production-ready UVT assets.",
  },
];

export async function runMusicSkill(params: {
  name: SkillName;
  context: SkillExecutionContext;
  input: Record<string, unknown>;
}): Promise<SkillExecutionResult> {
  switch (params.name) {
    case "PluginForge":
      return runPluginForge({
        prompt: String(params.input.prompt ?? "warm modern bass with punchy transient detail"),
        target: String(params.input.target ?? "webaudio") as "maxmsp" | "vst" | "webaudio",
        context: params.context,
      });
    case "StemUVT":
      return runStemUVT({
        inputTrackPath: String(params.input.inputTrackPath ?? "./track.wav"),
        context: params.context,
      });
    case "SampleOracle":
      return runSampleOracle({
        query: String(params.input.query ?? "vocal chop"),
        context: params.context,
      });
    case "SetForge":
      return runSetForge({
        setName: String(params.input.setName ?? "Friday Club Set"),
        tracks:
          (params.input.tracks as Array<{ title: string; key: string; energy: number }>) ?? [],
        context: params.context,
      });
    case "ChordDreamer":
      return runChordDreamer({
        seed: String(params.input.seed ?? "future garage"),
        key: String(params.input.key ?? "A minor"),
        bars: Number(params.input.bars ?? 8),
        context: params.context,
      });
    case "LiveGuard":
      return runLiveGuard({
        setName: String(params.input.setName ?? "Main Stage"),
        crowdEnergy: Number(params.input.crowdEnergy ?? 0.7),
        latencyMs: Number(params.input.latencyMs ?? 20),
        clipping: Boolean(params.input.clipping ?? false),
        context: params.context,
      });
    case "MixShadow":
      return runMixShadow({
        trackName: String(params.input.trackName ?? "Untitled Mix"),
        lufs: Number(params.input.lufs ?? -9),
        peakDb: Number(params.input.peakDb ?? -1.2),
        stereoWidth: Number(params.input.stereoWidth ?? 1.35),
        context: params.context,
      });
    case "MemoGravity":
      return runMemoGravity({
        memo: String(params.input.memo ?? "Build a darker second drop with vocal fragments"),
        mode: String(params.input.mode ?? "text") as "voice" | "text",
        context: params.context,
      });
  }
}

export {
  runPluginForge,
  runStemUVT,
  runSampleOracle,
  runSetForge,
  runChordDreamer,
  runLiveGuard,
  runMixShadow,
  runMemoGravity,
};

export type { SkillExecutionContext, SkillExecutionResult, SkillName } from "./types.js";
