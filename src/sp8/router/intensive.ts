const INTENSIVE_KEYWORDS = [
  "analyze",
  "deep",
  "reason",
  "multi-step",
  "vision",
  "image",
  "architect",
  "refactor",
  "security",
  "audit",
  "benchmark",
] as const;

export function isIntensiveTask(input: { prompt: string; estimatedChars?: number }): boolean {
  const prompt = input.prompt.toLowerCase();
  if (input.estimatedChars && input.estimatedChars > 2_000) {
    return true;
  }
  return INTENSIVE_KEYWORDS.some((keyword) => prompt.includes(keyword));
}
