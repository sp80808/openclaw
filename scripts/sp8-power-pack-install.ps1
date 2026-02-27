$ErrorActionPreference = "Stop"

param(
  [Parameter(Mandatory = $true)]
  [string]$VtReportPath
)

if (-not (Test-Path -LiteralPath $VtReportPath)) {
  throw "VirusTotal report not found: $VtReportPath"
}

$cliBin = if (Get-Command sp8 -ErrorAction SilentlyContinue) {
  "sp8"
} elseif (Get-Command openclaw -ErrorAction SilentlyContinue) {
  "openclaw"
} else {
  throw "Neither sp8 nor openclaw is available on PATH."
}

$skills = @(
  "pluginforge",
  "stemuvt",
  "sampleoracle",
  "setforge",
  "chorddreamer",
  "liveguard",
  "mixshadow",
  "memogravity"
)

$mcps = @(
  "mcporter",
  "playwright",
  "postgresql-readonly",
  "redis",
  "filesystem-scoped",
  "linear",
  "jira",
  "github-mcp"
)

foreach ($skill in $skills) {
  & $cliBin sp8 skill install $skill --safe --consent --sandbox-profile strict --vt-report $VtReportPath
}

foreach ($mcp in $mcps) {
  & $cliBin sp8 mcp add $mcp --consent --sandbox-profile strict --vt-report $VtReportPath
}

Write-Host "Sp8 Power Pack installation completed."
