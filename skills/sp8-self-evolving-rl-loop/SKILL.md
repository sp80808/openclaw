---
name: sp8-self-evolving-rl-loop
description: SP8 optional integration notes for self-evolving RL async loops.
homepage: https://github.com/Gen-Verse/OpenClaw-RL
metadata: { "openclaw": { "emoji": "♻️" } }
---

# SP8: Self-Evolving RL Loop

Fork source: https://github.com/Gen-Verse/OpenClaw-RL

Key ideas integrated:

- Fully async separation of collection, rewarding, and training loops.
- Background worker lifecycle controls (start/pause/resume/drain).
- Non-blocking queue/drain patterns and periodic checkpoint cadence.

Enable in this repo:

- `openclaw sp8 feature enable self-evolving-rl-loop`

Suggested optional steps:

- Keep RL pipeline out-of-band as an optional worker process.
- Use queue-drain telemetry and periodic weight sync points.

ClawHub discovery:

- `npx clawhub search "openclaw rl async"`
