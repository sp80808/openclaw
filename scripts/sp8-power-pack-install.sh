#!/usr/bin/env bash
set -euo pipefail

VT_REPORT_PATH="${1:-}"
if [[ -z "$VT_REPORT_PATH" ]]; then
  echo "Usage: $0 /path/to/virustotal-report.json" >&2
  exit 1
fi

if [[ ! -f "$VT_REPORT_PATH" ]]; then
  echo "VirusTotal report not found: $VT_REPORT_PATH" >&2
  exit 1
fi

if command -v sp8 >/dev/null 2>&1; then
  CLI_BIN="sp8"
elif command -v openclaw >/dev/null 2>&1; then
  CLI_BIN="openclaw"
else
  echo "Neither sp8 nor openclaw is installed on PATH." >&2
  exit 1
fi

SKILLS=(
  gog
  github
  summarize
  ontology
  self-improving-agent
  cognitive-memory
  trello
  slack
  caldav
  mcp-builder
  agentlens
  buildlog
  evolver
  linear
  agentmail
)

MCPS=(
  mcporter
  playwright
  postgresql-readonly
  redis
  filesystem-scoped
  linear
  jira
  github-mcp
)

for skill in "${SKILLS[@]}"; do
  "$CLI_BIN" sp8 skill install "$skill" \
    --safe \
    --consent \
    --sandbox-profile strict \
    --vt-report "$VT_REPORT_PATH"
done

for mcp in "${MCPS[@]}"; do
  "$CLI_BIN" sp8 mcp add "$mcp" \
    --consent \
    --sandbox-profile strict \
    --vt-report "$VT_REPORT_PATH"
done

echo "Sp8 Power Pack installation completed."
