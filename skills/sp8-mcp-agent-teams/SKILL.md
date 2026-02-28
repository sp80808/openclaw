---
name: sp8-mcp-agent-teams
description: SP8 optional integration notes for MCP servers and agent-team workflows.
homepage: https://github.com/Enderfga/openclaw-claude-code-skill
metadata: { "openclaw": { "emoji": "🧩" } }
---

# SP8: MCP Servers & Agent Teams

Fork source: https://github.com/Enderfga/openclaw-claude-code-skill

Key ideas integrated:

- Persistent MCP session model for long multi-step workflows.
- Team-role routing (`architect`, `developer`, `reviewer`) as optional agent topology.
- Tool allow/deny policy controls for safer delegated runs.

Enable in this repo:

- `openclaw sp8 feature enable mcp-agent-teams`

Suggested optional steps:

- Run MCP-backed sessions with explicit tool boundaries.
- Use agent-team JSON templates for role-specialized handoffs.

ClawHub discovery:

- `npx clawhub search "claude-code-skill"`
