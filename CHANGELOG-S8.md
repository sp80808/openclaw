# CHANGELOG-S8

## 2026-02-28

### Changes

- Added `openclaw sp8 feature enable <name>` via new SP8 CLI surface (`src/cli/sp8-cli.ts`) and command registration in `src/cli/program/register.subclis.ts`.
- Added SP8 local feature state persistence at `~/.openclaw/sp8/features.json` so fork-derived features are explicit and reversible.
- Added optional bundled skill packs for each selected fork concept:
  - `skills/sp8-antigravity-gemini-oauth/SKILL.md`
  - `skills/sp8-self-evolving-rl-loop/SKILL.md`
  - `skills/sp8-cognitive-memory-kg/SKILL.md`
  - `skills/sp8-mcp-agent-teams/SKILL.md`
  - `skills/sp8-resilient-browser-relay/SKILL.md`
  - `skills/sp8-time-travel-debugger/SKILL.md`
  - `skills/sp8-local-first-routing/SKILL.md`

### Fork merge notes

- `lutpd/openclaw-antigravity1`
  - Selectively merged OAuth flow ideas: PKCE, localhost callback, and remote/manual callback fallback behavior.
  - Kept integration optional and skill-driven; no mandatory auth-provider mutation.

- `Gen-Verse/OpenClaw-RL`
  - Selectively merged architecture ideas: async decoupling of rollout/reward/train loops and queue-drain control points.
  - Exposed as optional SP8 feature to avoid introducing heavy runtime dependencies into core paths.

- `globalcaos/clawdbot-moltbot-openclaw`
  - Selectively merged memory strategy ideas: sqlite-vec acceleration, hybrid retrieval posture, nightly consolidation cadence.
  - Kept as optional operational profile through SP8 feature + skill guidance.

- `Enderfga/openclaw-claude-code-skill`
  - Selectively merged MCP team concepts: persistent sessions, role-specialized agents, tool-scoped guardrails.
  - Preserved OpenClaw-native command shape and plugin boundaries.

- `Unayung/openclaw-browser-relay`
  - Selectively merged resilience patterns: reconnect jitter, state restore, keepalive, and lifecycle cleanup model.
  - Added as optional SP8 feature so browser relay behavior remains explicitly opt-in.

- `MurbotLabs/Forked`
  - Selectively merged time-travel debugger patterns: trace stream taxonomy, fork/rewind mental model, timeline lineage concepts.
  - Exposed as optional SP8 feature with no required daemon/UI dependency in core runtime.

- LocalClaw-style community forks (`LocalClaw` search space)
  - Selectively merged local-first routing/fallback policy concepts as optional feature scaffolding.

### Licensing

- All integrated concepts are sourced from MIT-licensed forks or represented as non-copying behavioral patterns.
- No third-party source files were copied verbatim into OpenClaw core in this SP8 integration pass.
