---
name: sp8-safety-rails
description: SP8 safety rails — task-class routing awareness, fallback chain hardening, user confirmation gates, and metrics dashboard.
metadata: { "openclaw": { "emoji": "🛡️" } }
---

# SP8: Safety Rails & Integration

Safety and integration layer that connects self-improvement (Sp8SelfImprove)
and model discovery (Sp8ModelHunter) into a coherent, safe routing system.

## Features

### Task-Class Routing Awareness

Classifies incoming tasks automatically and routes to the best model for that class:

- `coding` / `reasoning` / `planning` / `agent` / `vision` / `speed` / `general`

### Fallback Chain Hardening

- If primary free model returns 429 three consecutive times → auto-downgrade
- Circuit breaker with configurable cooldown period
- User notification on model downgrades

### User Confirmation Gate

- `--auto-apply` flag off by default for evolve patches
- `--auto-promote` off by default for model promotions
- All mutations are logged for audit

### Metrics Dashboard

```bash
# View full metrics — win rates, fallback events, routing decisions
sp8 evolve report

# JSON output for programmatic consumption
sp8 evolve report --json
```

Includes ASCII win-rate-over-time chart in terminal output.

## Safety Config

```bash
# Defaults (stored in ~/.openclaw/sp8/rails/safety.json)
{
  "maxConsecutive429s": 3,
  "autoApplyEvolve": false,
  "autoPromoteModels": false,
  "fallbackCooldownMs": 1800000,
  "notifyOnChanges": true
}
```

## Files

- `src/sp8/safety-rails.ts` — Routing, fallback, metrics, config
- `src/sp8/safety-rails.test.ts` — Tests
- `~/.openclaw/sp8/rails/` — State (fallback events, decisions, safety config)
