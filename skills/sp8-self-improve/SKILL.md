---
name: sp8-self-improve
description: SP8 agentic self-improvement loop with v1–v5 variants (RLHF, Reflexion, Agent-as-Judge, Evolutionary, Distilled RL).
metadata: { "openclaw": { "emoji": "🧬" } }
---

# SP8: Agentic Self-Improvement (Sp8SelfImprove)

Periodic agent loop that evaluates and improves assistant behavior using multiple
self-improvement techniques. Runs on command or on a schedule.

## Variants

| Variant | Technique                                      | Success Lift      | Compute        | When to Use           |
| ------- | ---------------------------------------------- | ----------------- | -------------- | --------------------- |
| v1      | Conversational RLHF (thumbs up/down)           | +15–25%           | Very low       | Default / lightweight |
| v2      | Reflexion + self-critique (2–4 iterations)     | +30–45%           | Low–medium     | Reasoning heavy tasks |
| v3      | Agent-as-Judge (local judge scores candidates) | +40–60%           | Medium         | Consensus mode        |
| v4      | Evolutionary prompt/tool search (tournament)   | +50–90% long-term | High (batched) | Nightly evolution     |
| v5      | Distilled RL from strong free model            | +70–120% ceiling  | High (GPU)     | Power users           |

## CLI Usage

```bash
# Record a feedback signal
sp8 evolve signal --signal "great tool-use on file search" --delta 1

# Record an interaction for training
sp8 evolve record --task "refactor auth module" --result "extracted 3 helpers" --score 0.8

# Run self-improvement loop (default: v3 Agent-as-Judge)
sp8 evolve full --mode v3

# Run with auto-apply (no user veto)
sp8 evolve full --mode v3 --auto-apply

# Evolutionary search (v4, runs longer)
sp8 evolve full --mode v4 --population 16

# View improvement metrics and win-rate chart
sp8 evolve report
```

## How It Works

1. Loads recent interactions from `~/.openclaw/sp8/evolve/interactions.jsonl`
2. Generates improvement candidates using the selected variant technique
3. Scores all candidates against held-out hard tasks
4. Shows before/after comparison on 3 past difficult tasks
5. Applies winning patch only with `--auto-apply` (user veto by default)
6. Persists history for `evolve report` metrics

## Files

- `src/sp8/self-improve.ts` — Core loop implementation
- `src/sp8/evolve.ts` — Signal recording (v1 foundation)
- `src/sp8/self-improve.test.ts` — Tests
- `~/.openclaw/sp8/evolve/` — State directory (interactions, candidates, history)
