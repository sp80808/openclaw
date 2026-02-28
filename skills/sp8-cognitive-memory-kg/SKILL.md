---
name: sp8-cognitive-memory-kg
description: SP8 optional integration notes for cognitive memory and personal KG patterns.
homepage: https://github.com/globalcaos/clawdbot-moltbot-openclaw
metadata: { "openclaw": { "emoji": "🧠" } }
---

# SP8: Cognitive Memory / Personal KG

Fork source: https://github.com/globalcaos/clawdbot-moltbot-openclaw

Key ideas integrated:

- sqlite-vec acceleration with graceful JS fallback.
- Hybrid retrieval (vector + FTS) and dedupe-aware indexing.
- Nightly/sleep consolidation and memory hygiene loops.

Enable in this repo:

- `openclaw sp8 feature enable cognitive-memory-kg`

Suggested optional steps:

- Validate vector extension availability with a smoke check.
- Run periodic consolidation jobs for long-lived memory stores.

ClawHub discovery:

- `npx clawhub search "sqlite-vec memory"`
