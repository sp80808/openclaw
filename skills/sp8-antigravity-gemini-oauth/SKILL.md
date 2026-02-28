---
name: sp8-antigravity-gemini-oauth
description: SP8 optional integration notes for Antigravity + Gemini OAuth flows.
homepage: https://github.com/lutpd/openclaw-antigravity1
metadata: { "openclaw": { "emoji": "🛰️" } }
---

# SP8: Antigravity + Gemini OAuth

Fork source: https://github.com/lutpd/openclaw-antigravity1

Key ideas integrated:

- PKCE OAuth with localhost callback and manual URL paste fallback for remote/WSL hosts.
- Gemini CLI OAuth credential discovery from installed CLI where possible.
- Provider patching as optional plugin-style auth.

Enable in this repo:

- `openclaw sp8 feature enable antigravity-gemini-oauth`

Suggested optional steps:

- `openclaw plugins enable google-gemini-cli-auth`
- `openclaw models auth login --provider google-gemini-cli --set-default`
- `openclaw plugins enable google-antigravity-auth`
- `openclaw models auth login --provider google-antigravity --set-default`

ClawHub discovery:

- `npx clawhub search "google-antigravity-auth"`
