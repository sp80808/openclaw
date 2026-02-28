---
name: sp8-local-first-routing
description: SP8 optional integration notes for LocalClaw-style local-first routing.
homepage: https://github.com/search?q=LocalClaw+openclaw&type=repositories
metadata: { "openclaw": { "emoji": "🏠" } }
---

# SP8: Local-first Routing

Fork source: https://github.com/search?q=LocalClaw+openclaw&type=repositories

Key ideas integrated:

- Prefer local execution path first, then remote/provider fallback.
- Keep routing policy explicit and observable per session.
- Preserve offline-friendly behavior where possible.

Enable in this repo:

- `openclaw sp8 feature enable local-first-routing`

Suggested optional steps:

- Pin local-first policies in agent defaults.
- Keep fallback tiers deterministic and logged.

ClawHub discovery:

- `npx clawhub search "localclaw openclaw"`
