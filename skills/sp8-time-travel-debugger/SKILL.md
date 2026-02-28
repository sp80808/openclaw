---
name: sp8-time-travel-debugger
description: SP8 optional integration notes for time-travel tracing and replay.
homepage: https://github.com/MurbotLabs/Forked
metadata: { "openclaw": { "emoji": "⏪" } }
---

# SP8: Time-travel Debugger

Fork source: https://github.com/MurbotLabs/Forked

Key ideas integrated:

- Structured trace streams (LLM/tool/lifecycle) for replayable run history.
- Fork + rewind from sequence points for branch debugging.
- Timeline lanes for parent/child run lineage.

Enable in this repo:

- `openclaw sp8 feature enable time-travel-debugger`

Suggested optional steps:

- Capture run-level events into a local trace store.
- Build replay checkpoints from fork sequence metadata.

ClawHub discovery:

- `npx clawhub search "forked openclaw"`
