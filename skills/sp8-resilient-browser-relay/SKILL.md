---
name: sp8-resilient-browser-relay
description: SP8 optional integration notes for resilient browser relay behavior.
homepage: https://github.com/Unayung/openclaw-browser-relay
metadata: { "openclaw": { "emoji": "🌐" } }
---

# SP8: Resilient Browser Relay

Fork source: https://github.com/Unayung/openclaw-browser-relay

Key ideas integrated:

- Keep debugger sessions attached across relay WebSocket drops.
- Exponential backoff reconnect with jitter and session re-announce.
- MV3 service worker state persistence and tab lifecycle cleanup.

Enable in this repo:

- `openclaw sp8 feature enable resilient-browser-relay`

Suggested optional steps:

- Add keepalive alarms and session restore checks for long-running browser automations.
- Preserve attachment state across service-worker restarts.

ClawHub discovery:

- `npx clawhub search "browser relay resilient"`
