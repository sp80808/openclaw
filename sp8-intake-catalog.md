# SP8 Intake Catalog

Updated: 2026-02-28

## Local inventory (already in this repo)

### MCP surfaces

- `src/sp8/mcp/server-registry.ts` — SP8 MCP config read/write + skill auto-wrap.
- `src/cli/sp8-cli.ts` — `sp8 mcp add|list|sync-skills` command surface.
- `src/commands/sp8-power-pack.ts` — vetted MCP allowlist + add flow.
- Trusted MCPs currently in code:
  - `mcporter`
  - `playwright`
  - `postgresql-readonly`
  - `redis`
  - `filesystem-scoped`
  - `linear`
  - `jira`
  - `github-mcp`

### Skills

- Core + extension skills discovered: `62` (`skills/**/SKILL.md`, `extensions/**/skills/**/SKILL.md`).
- Primary metadata model: `src/agents/skills/types.ts` (`OpenClawSkillMetadata`).

### SOUL templates / persona seeds

- `docs/reference/templates/SOUL.md`
- `docs/zh-CN/reference/templates/SOUL.md`

### Prompt-bank style files

- `.pi/prompts/cl.md`
- `.pi/prompts/reviewpr.md`
- `.pi/prompts/landpr.md`
- `.pi/prompts/is.md`

---

## External intake candidates (high-signal)

### MCP catalogs / servers

- `https://github.com/punkpeye/awesome-mcp-servers`
- `https://github.com/github/github-mcp-server`
- `https://github.com/microsoft/playwright-mcp`
- `https://github.com/awslabs/mcp`
- `https://github.com/makenotion/notion-mcp-server`
- `https://github.com/firecrawl/firecrawl-mcp-server`

### Prompt banks

- `https://github.com/ai-boost/awesome-prompts`
- `https://github.com/promptslab/Awesome-Prompt-Engineering`
- `https://github.com/browser-use/awesome-prompts`

### SOUL / agent persona collections

- `https://github.com/aaronjmars/soul.md`
- `https://github.com/thedaviddias/souls-directory`
- `https://github.com/mergisi/awesome-openclaw-agents`
- `https://github.com/will-assistant/openclaw-agents`

---

## Practical storage plan

Use one local state root and keep raw source snapshots separate from normalized records:

- Raw snapshots: `~/.openclaw/sp8/intake/raw/<source>/<date>.json`
- Normalized index: `~/.openclaw/sp8/intake/index.jsonl`
- Dedupe ledger: `~/.openclaw/sp8/intake/dedupe.json`
- Review queue: `~/.openclaw/sp8/intake/review.jsonl`

### Normalized record shape (JSONL)

```json
{
  "kind": "mcp|skill|soul|prompt",
  "id": "owner/repo#path-or-key",
  "title": "string",
  "source": "url",
  "tags": ["sp8", "mcp"],
  "license": "unknown",
  "trust": "high|medium|low",
  "addedAt": "2026-02-28T00:00:00.000Z"
}
```

## Next collection passes

1. Build a small ingest script for GitHub repos/topics -> `index.jsonl`.
2. Add license + star threshold filtering before promoting to `review.jsonl`.
3. Add `sp8 intake sync` CLI command for repeatable updates.
