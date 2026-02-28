export type Sp8Hardware = {
  ramGb: number;
  cpuCount: number;
};

export type Sp8Runtimes = {
  ollama: boolean;
  llamaCpp: boolean;
  vllm: boolean;
};

export type Sp8Profile = "privacy-max" | "balanced" | "speed-demon" | "zero-cloud";

export type Sp8FreeFirstPlan = {
  profile: Sp8Profile;
  local: {
    primaryModel: string;
    visionModel: string;
    toolModel: string;
  };
  cloudFallback: string[];
  runtimes: Sp8Runtimes;
  airgap: boolean;
  nextSteps: string[];
};

export function recommendLocalProfile(hardware: Sp8Hardware): Sp8Profile {
  if (hardware.ramGb >= 48) {
    return "privacy-max";
  }
  if (hardware.ramGb >= 24) {
    return "balanced";
  }
  return "speed-demon";
}

function primaryModelForRam(ramGb: number): string {
  if (ramGb >= 48) {
    return "qwen2.5:32b-instruct-q4_K_M";
  }
  if (ramGb >= 24) {
    return "qwen2.5:14b-instruct-q5_K_M";
  }
  return "llama3.1:8b-instruct-q4_K_M";
}

export function buildFreeFirstPlan(params: {
  hardware: Sp8Hardware;
  runtimes: Sp8Runtimes;
  profile: Sp8Profile;
  airgap: boolean;
}): Sp8FreeFirstPlan {
  const local = {
    primaryModel: primaryModelForRam(params.hardware.ramGb),
    visionModel: params.hardware.ramGb >= 24 ? "llava:13b-v1.6-q4_K_M" : "moondream2:latest",
    toolModel: params.hardware.ramGb >= 24 ? "qwen2.5:14b-instruct-q5_K_M" : "command-r:7b",
  };

  const cloudFallback = params.airgap
    ? []
    : ["google/gemini-2.5-flash", "groq/llama-3.3-70b-versatile", "openrouter/free:*"];

  const nextSteps = [
    params.runtimes.ollama
      ? "Ollama detected: pull recommended models and run local-only tests."
      : "Install Ollama, then pull recommended models.",
    params.airgap
      ? "Set SP8_AIRGAP=1 to enforce zero external requests."
      : "Enable free cloud fallback for burst traffic and outages.",
    "Run: sp8 router status --history to verify health scoring and cooldown behavior.",
  ];

  return {
    profile: params.profile,
    local,
    cloudFallback,
    runtimes: params.runtimes,
    airgap: params.airgap,
    nextSteps,
  };
}
