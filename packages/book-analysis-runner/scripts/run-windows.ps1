[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RunnerArguments
)

$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $PSScriptRoot
$cliPath = Join-Path $packageRoot "dist\cli.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not available. Install Node 24 or later, then try again."
}

if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
  throw "Runner build not found. Run 'corepack pnpm book-analysis:build' from the repository root first."
}

& node $cliPath @RunnerArguments
exit $LASTEXITCODE
