/**
 * Lightweight LLM-as-judge for scoring agent trajectories.
 *
 * Designed to run on 3–9B quantized local models via Ollama-compatible API.
 * Prompt ≈ 800–1400 tokens → judge cost is negligible (~0.3% of normal inference).
 *
 * When judge is unavailable, falls back to heuristic scoring (zero extra tokens).
 */

import type { Sp8JudgeOutput, Sp8ToolCall } from "./types.js";

const JUDGE_SYSTEM_PROMPT = `You are a strict but fair tool-use & reasoning judge.
Given a user query, agent trajectory (tool calls + observations), and final answer,
output ONLY valid JSON with these exact fields:

{
  "toolSelectionCorrect": <0-10>,
  "toolExecutionQuality": <0-10>,
  "reasoningCoherence": <0-10>,
  "finalAnswerHelpfulness": <0-10>,
  "overallSuccessProb": <0.0-1.0>
}

Scoring guide:
- toolSelectionCorrect: Did the agent pick sensible tools in a logical order?
- toolExecutionQuality: Were arguments correct? Were errors handled gracefully?
- reasoningCoherence: Was the chain of thought logical and focused?
- finalAnswerHelpfulness: Would the user find this answer useful and complete?
- overallSuccessProb: Your Bayesian belief the user will be satisfied (0.0 = certain fail, 1.0 = certain success).

Be concise. Output JSON only, no explanation.`;

function buildJudgeUserPrompt(params: {
  query: string;
  toolsCalled: Sp8ToolCall[];
  finalAnswer: string;
}): string {
  const toolSection =
    params.toolsCalled.length > 0
      ? params.toolsCalled
          .slice(-4) // Only last 4 tool calls to keep tokens low
          .map(
            (tc, idx) =>
              `${idx + 1}. ${tc.name} (${tc.durationMs}ms, ${tc.success ? "ok" : "FAIL"})`,
          )
          .join("\n")
      : "(no tools called)";

  // Truncate final answer to ~500 chars to keep judge prompt small
  const answer =
    params.finalAnswer.length > 500 ? `${params.finalAnswer.slice(0, 500)}…` : params.finalAnswer;

  return `Query: ${params.query.slice(0, 300)}

Trajectory (last tool calls):
${toolSection}

Final answer:
${answer}`;
}

/** Default judge output when judge is unavailable or fails. */
const FALLBACK_JUDGE: Sp8JudgeOutput = {
  toolSelectionCorrect: 5,
  toolExecutionQuality: 5,
  reasoningCoherence: 5,
  finalAnswerHelpfulness: 5,
  overallSuccessProb: 0.5,
};

/**
 * Parse the judge's JSON response, tolerating minor formatting issues.
 */
function parseJudgeResponse(raw: string): Sp8JudgeOutput | null {
  // Try to extract JSON from the response (judge might wrap in markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const clamp = (val: unknown, min: number, max: number, fallback: number): number => {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        return fallback;
      }
      return Math.max(min, Math.min(max, val));
    };

    return {
      toolSelectionCorrect: clamp(parsed.toolSelectionCorrect, 0, 10, 5),
      toolExecutionQuality: clamp(parsed.toolExecutionQuality, 0, 10, 5),
      reasoningCoherence: clamp(parsed.reasoningCoherence, 0, 10, 5),
      finalAnswerHelpfulness: clamp(parsed.finalAnswerHelpfulness, 0, 10, 5),
      overallSuccessProb: clamp(parsed.overallSuccessProb, 0, 1, 0.5),
    };
  } catch {
    return null;
  }
}

/**
 * Convert a JudgeOutput to a single scalar score ∈ [0, 1].
 * Weighted: overallSuccessProb gets 40%, subscores each get 15%.
 */
export function judgeOutputToScore(output: Sp8JudgeOutput): number {
  const subscoreAvg =
    (output.toolSelectionCorrect +
      output.toolExecutionQuality +
      output.reasoningCoherence +
      output.finalAnswerHelpfulness) /
    40; // Each is 0-10, 4 of them, normalize to 0-1

  return 0.4 * output.overallSuccessProb + 0.6 * subscoreAvg;
}

export type JudgeDeps = {
  fetchImpl?: typeof fetch;
};

/**
 * Call the local judge model via Ollama-compatible chat API.
 * Returns a score ∈ [0, 1].
 *
 * Timeout: 15s (if judge is slow, we fall back rather than block).
 */
export async function runJudge(params: {
  endpoint: string;
  model: string;
  query: string;
  toolsCalled: Sp8ToolCall[];
  finalAnswer: string;
  deps?: JudgeDeps;
}): Promise<{ score: number; output: Sp8JudgeOutput; fromFallback: boolean }> {
  const fetchFn = params.deps?.fetchImpl ?? fetch;
  const userPrompt = buildJudgeUserPrompt({
    query: params.query,
    toolsCalled: params.toolsCalled,
    finalAnswer: params.finalAnswer,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetchFn(`${params.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        stream: false,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        options: {
          temperature: 0.1, // Low temp for consistent scoring
          num_predict: 256, // Judge output is small
        },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { score: 0.5, output: FALLBACK_JUDGE, fromFallback: true };
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content ?? "";
    const parsed = parseJudgeResponse(content);

    if (!parsed) {
      return { score: 0.5, output: FALLBACK_JUDGE, fromFallback: true };
    }

    return {
      score: judgeOutputToScore(parsed),
      output: parsed,
      fromFallback: false,
    };
  } catch {
    // Judge unavailable — use heuristic fallback (zero cost)
    return { score: 0.5, output: FALLBACK_JUDGE, fromFallback: true };
  }
}

/**
 * Heuristic judge: scores based on observable signals without any LLM call.
 * Used when local judge model is not available (v0.1 default).
 *
 * Signals:
 * - Tool success rate
 * - Number of tools called (more tools = more complex = slightly lower base)
 * - Latency (faster = slightly better, with diminishing returns)
 * - Final answer length (very short answers are suspicious)
 */
export function heuristicScore(params: {
  toolsCalled: Sp8ToolCall[];
  finalAnswer: string;
  latencyMs: number;
}): number {
  let score = 0.5; // Base neutral score

  // Tool success rate contribution (±0.2)
  if (params.toolsCalled.length > 0) {
    const successRate =
      params.toolsCalled.filter((t) => t.success).length / params.toolsCalled.length;
    score += (successRate - 0.5) * 0.4;
  }

  // Answer length signal (very short = suspicious, moderate = good)
  const answerLen = params.finalAnswer.trim().length;
  if (answerLen < 10) {
    score -= 0.15;
  } else if (answerLen > 50 && answerLen < 2000) {
    score += 0.1;
  }

  // Latency signal (under 5s = good, over 30s = penalty)
  if (params.latencyMs < 5000) {
    score += 0.05;
  } else if (params.latencyMs > 30_000) {
    score -= 0.05;
  }

  return Math.max(0, Math.min(1, score));
}

// Re-export for testing
export {
  buildJudgeUserPrompt as _buildJudgeUserPrompt,
  parseJudgeResponse as _parseJudgeResponse,
  JUDGE_SYSTEM_PROMPT,
};
