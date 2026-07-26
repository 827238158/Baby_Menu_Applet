$ErrorActionPreference = 'Stop'

# 固定 Git 和 Node 的绝对路径，避免嵌套 PowerShell 丢失 PATH。
$gitCommand = Get-Command git -ErrorAction Stop
$nodeCommand = Get-Command node -ErrorAction Stop
$gitPath = $gitCommand.Path
$nodePath = $nodeCommand.Path
$hookDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$hookScript = Join-Path $hookDirectory 'current-memory-guard.cjs'
$hookInput = [Console]::In.ReadToEnd()

$hookInput | & $nodePath $hookScript --git $gitPath
exit $LASTEXITCODE
