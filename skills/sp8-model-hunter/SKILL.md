---
name: sp8-model-hunter
description: SP8 agentic free model discovery — scrapes OpenRouter, ranks by agent/tool-use strength, shadow-tests candidates, promotes winners.
metadata: { "openclaw": { "emoji": "🔍" } }
---

# SP8: Model Hunter (Sp8ModelHunter)

Automated discovery, evaluation, and promotion of free models from OpenRouter
(and Gemini CLI tiers). Runs as a background cron or on-demand via CLI.

## Pipeline

1. **Research** — Fetch free models from OpenRouter `/models?pricing=free`
2. **Filter & Rank** — Score by agent/tool-calling strength, reasoning, speed, vision, context length
3. **Shadow-Test** — Run top 3–5 candidates against 20–50 held-out tasks (no user visible)
4. **Promote** — Winners get higher routing priority for their task class

## Known Strong Free Models (Feb 2026)

- **Qwen3 series** (Coder-Next, 80B, 235B) — strongest coding + agent-tool use
- **GLM-4.5-Air / GLM-4.7-Thinking** — purpose-built for agents
- **DeepSeek-V3.2 Speciale / Thinking** — excellent reasoning + tool-use
- **StepFun Step 3.5 Flash** — very fast free inference
- **Arcee Trinity Large Preview** — solid general-purpose
- **NVIDIA Nemotron variants** (Nano 30B, Embed VL) — fast + multimodal
- **Llama Nemotron / Llama 4 Scout/Maverick** (when available)

## CLI Usage

```bash
# Discover, shadow-test, and promote free models (agent-tool-use focus)
sp8 models hunt --focus agent-tool-use --max-candidates 8

# Hunt with different focus areas
sp8 models hunt --focus coding
sp8 models hunt --focus reasoning
sp8 models hunt --focus speed

# View current routing weights and win rates
sp8 models status

# View shadow-test history
sp8 models shadow-history --limit 20

# Airgap mode (no network calls)
sp8 models hunt --airgap
```

## Task-Class Routing

After promotion, the router learns task-class-specific preferences:

- **coding** → Qwen3-Coder-Next (85% win rate)
- **reasoning** → GLM-4.7-Thinking (78% win rate)
- **agent** → GLM-4.5-Air (82% win rate)
- **speed** → Step 3.5 Flash (90% win rate)

## Files

- `src/sp8/model-hunter.ts` — Discovery, scoring, shadow-test, promotion
- `src/sp8/model-hunter.test.ts` — Tests
- `~/.openclaw/sp8/model-hunter/` — State (promotions, shadow results, hunt history)
