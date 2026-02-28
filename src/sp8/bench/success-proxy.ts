/**
 * Cheap success proxy — derives a reward signal from observable user behavior.
 *
 * No human labeling needed. Signals:
 * - 1.0  = explicit positive (thumbs-up, /good, "thanks", "perfect")
 * - 0.5  = neutral (multi-turn continuation, no explicit signal)
 * - 0.0  = explicit negative (thumbs-down, /bad, "wrong", abandoned after 1 reply)
 *
 * This is the "almost free" reward signal that runs on every request.
 */

import type { Sp8TaskClass } from "./types.js";

/** Keywords that signal explicit satisfaction. */
const POSITIVE_KEYWORDS = [
  "thanks",
  "thank you",
  "perfect",
  "great",
  "awesome",
  "exactly",
  "works",
  "good job",
  "nice",
  "love it",
  "👍",
  "🎉",
  "✅",
] as const;

/** Keywords / patterns that signal explicit dissatisfaction. */
const NEGATIVE_KEYWORDS = [
  "wrong",
  "bad",
  "incorrect",
  "not what i",
  "try again",
  "no that's",
  "undo",
  "revert",
  "broken",
  "fail",
  "useless",
  "👎",
  "❌",
] as const;

/** Commands that explicitly signal satisfaction. */
const POSITIVE_COMMANDS = ["/good", "/thumbsup", "/sp8 good"] as const;

/** Commands that explicitly signal dissatisfaction. */
const NEGATIVE_COMMANDS = ["/bad", "/thumbsdown", "/reset", "/sp8 bad"] as const;

export type SuccessProxySignals = {
  /** The user's next message after the agent response, if any. */
  nextUserMessage: string | null;
  /** Whether the user gave explicit thumbs up/down. */
  userThumbs: boolean | null;
  /** Whether the conversation continued (multi-turn). */
  conversationContinued: boolean;
  /** Whether the agent's final response contained an error/apology. */
  agentErrored: boolean;
  /** Number of tool calls that failed. */
  failedToolCalls: number;
  /** Total tool calls. */
  totalToolCalls: number;
};

/**
 * Compute a success proxy score ∈ [0, 0.5, 1] from observable signals.
 * This is intentionally coarse — three-level quantization works well
 * for bandit updates and avoids noisy continuous estimates.
 */
export function computeSuccessProxy(signals: SuccessProxySignals): number {
  // Explicit thumbs override everything
  if (signals.userThumbs === true) {
    return 1.0;
  }
  if (signals.userThumbs === false) {
    return 0.0;
  }

  // Agent self-reported error is a strong negative
  if (signals.agentErrored) {
    return 0.0;
  }

  // High tool failure rate is a strong negative
  if (signals.totalToolCalls > 0 && signals.failedToolCalls / signals.totalToolCalls > 0.5) {
    return 0.0;
  }

  // Check next user message for explicit signals
  if (signals.nextUserMessage) {
    const lower = signals.nextUserMessage.toLowerCase().trim();

    // Check explicit commands first
    for (const cmd of POSITIVE_COMMANDS) {
      if (lower.startsWith(cmd)) {
        return 1.0;
      }
    }
    for (const cmd of NEGATIVE_COMMANDS) {
      if (lower.startsWith(cmd)) {
        return 0.0;
      }
    }

    // Check keyword signals
    for (const kw of POSITIVE_KEYWORDS) {
      if (lower.includes(kw)) {
        return 1.0;
      }
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (lower.includes(kw)) {
        return 0.0;
      }
    }
  }

  // Conversation continued without explicit signal = neutral
  if (signals.conversationContinued) {
    return 0.5;
  }

  // No follow-up at all (abandoned after 1 reply) — slight negative
  if (!signals.nextUserMessage && !signals.conversationContinued) {
    return 0.0;
  }

  return 0.5;
}

/**
 * Compute a composite score from judge + proxy.
 * Default weights: 0.7 judge + 0.3 proxy.
 */
export function compositeScore(
  judgeScore: number,
  proxyScore: number,
  judgeWeight = 0.7,
  proxyWeight = 0.3,
): number {
  return Math.max(0, Math.min(1, judgeWeight * judgeScore + proxyWeight * proxyScore));
}

// --- Task classification ---

/** Keywords that indicate each task class. Cheap regex-free matching. */
const TASK_CLASS_KEYWORDS: Record<Sp8TaskClass, readonly string[]> = {
  coding: [
    "code",
    "function",
    "class",
    "bug",
    "fix",
    "implement",
    "refactor",
    "test",
    "compile",
    "typescript",
    "python",
    "javascript",
    "rust",
    "api",
    "endpoint",
    "debug",
    "error",
    "lint",
    "build",
    "deploy",
    "git",
    "commit",
    "merge",
    "pr",
    "pull request",
  ],
  planning: [
    "plan",
    "design",
    "architect",
    "strategy",
    "roadmap",
    "milestone",
    "breakdown",
    "scope",
    "estimate",
    "prioritize",
    "decision",
    "tradeoff",
    "spec",
    "rfc",
    "proposal",
  ],
  browser: [
    "browse",
    "website",
    "webpage",
    "url",
    "click",
    "navigate",
    "scrape",
    "download",
    "search web",
    "google",
    "screenshot",
    "html",
    "css",
    "dom",
    "selenium",
    "playwright",
  ],
  device: [
    "device",
    "phone",
    "notification",
    "bluetooth",
    "camera",
    "microphone",
    "gps",
    "sensor",
    "home",
    "iot",
    "homekit",
    "siri",
    "shortcut",
    "automation",
  ],
  chat: [
    "chat",
    "tell me",
    "what is",
    "explain",
    "help",
    "how do",
    "why",
    "opinion",
    "suggest",
    "recommend",
    "translate",
    "summarize",
    "write",
    "draft",
    "email",
    "message",
  ],
};

/**
 * Classify a query into a task class using lightweight keyword matching.
 * Returns the class with the highest keyword hit count.
 * Falls back to "chat" if no clear signal.
 */
export function classifyTaskClass(query: string): Sp8TaskClass {
  const lower = query.toLowerCase();
  let bestClass: Sp8TaskClass = "chat";
  let bestScore = 0;

  for (const [taskClass, keywords] of Object.entries(TASK_CLASS_KEYWORDS)) {
    let hits = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        hits += 1;
      }
    }
    if (hits > bestScore) {
      bestScore = hits;
      bestClass = taskClass as Sp8TaskClass;
    }
  }

  return bestClass;
}

/**
 * Non-reversible hash of a query string for privacy-safe trajectory storage.
 * Simple FNV-1a 32-bit hash — fast and good distribution.
 */
export function hashQuery(query: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let idx = 0; idx < query.length; idx += 1) {
    hash ^= query.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // Ensure unsigned 32-bit
}
