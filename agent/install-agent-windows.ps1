#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
    SkyWatch Windows Agent Installer v1.0.0
.DESCRIPTION
    Downloads and installs the SkyWatch agent as a Windows Task Scheduler job
    that starts at boot and runs as SYSTEM.
.PARAMETER ServerUrl
    SkyWatch server URL (required), e.g. https://skywatch.necloud.us
.PARAMETER AgentName
    Display name for this agent (default: computer name)
.PARAMETER Interval
    Reporting interval in seconds (default: 60)
.PARAMETER RegistrationKey
    Optional registration key if server requires one
.PARAMETER Uninstall
    Remove the agent and its scheduled task
.EXAMPLE
    .\install-agent-windows.ps1 -ServerUrl https://skywatch.necloud.us
.EXAMPLE
    .\install-agent-windows.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$ServerUrl,
    [string]$AgentName,
    [int]   $Interval = 60,
    [string]$RegistrationKey,
    [switch]$Uninstall
)

$TaskName   = "SkyWatch Agent"
$InstallDir = "C:\ProgramData\SkyWatch"
$AgentScript = "$InstallDir\skywatch-agent-windows.ps1"
$ConfigFile  = "$InstallDir\agent.conf"

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "    $Msg"  -ForegroundColor Green }
function Write-Err  { param([string]$Msg) Write-Host "    ERROR: $Msg" -ForegroundColor Red; exit 1 }

# ── Uninstall ──────────────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Step "Removing SkyWatch Agent ..."
    Stop-ScheduledTask   -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    Write-OK "SkyWatch Agent removed."
    exit 0
}

# ── Validate ───────────────────────────────────────────────────────────────────
if (-not $ServerUrl) {
    Write-Err "ServerUrl is required.`nExample: .\install-agent-windows.ps1 -ServerUrl https://skywatch.necloud.us"
}

# ── Install ────────────────────────────────────────────────────────────────────
Write-Step "Creating install directory ..."
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Write-OK $InstallDir

Write-Step "Downloading agent script from $ServerUrl ..."
try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "$ServerUrl/api/agents/script-windows" `
                      -OutFile $AgentScript -UseBasicParsing -TimeoutSec 30
    Write-OK "Saved to $AgentScript"
} catch {
    Write-Err "Download failed: $_"
}

Write-Step "Writing configuration ..."
$name = if ($AgentName) { $AgentName } else { $env:COMPUTERNAME }
@"
SKYWATCH_URL="$ServerUrl"
AGENT_TOKEN=""
REPORT_INTERVAL=$Interval
AGENT_NAME="$name"
REGISTRATION_KEY="$RegistrationKey"
"@ | Set-Content $ConfigFile -Encoding UTF8
Write-OK "Config saved to $ConfigFile"

# Allow scripts to run (per-machine, won't affect user policy)
Write-Step "Setting PowerShell execution policy ..."
try {
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force -ErrorAction Stop
    Write-OK "RemoteSigned (LocalMachine)"
} catch {
    Write-Host "    (Could not set policy — you may need to run: Set-ExecutionPolicy RemoteSigned)" -ForegroundColor Yellow
}

Write-Step "Registering scheduled task ..."
# Remove any previous install
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$psArgs = "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AgentScript`" -ConfigFile `"$ConfigFile`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs

$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(10) `
        -RepetitionInterval (New-TimeSpan -Minutes 5))   # restart every 5 min if it exits
)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit  (New-TimeSpan -Hours 0) `
    -RestartCount        5 `
    -RestartInterval     (New-TimeSpan -Minutes 1) `
    -MultipleInstances   IgnoreNew `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId    "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel  Highest

Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $action `
    -Trigger   $triggers `
    -Settings  $settings `
    -Principal $principal `
    -Force | Out-Null

Write-OK "Task '$TaskName' created"

Write-Step "Starting agent ..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-OK "Task state: $state"

Write-Host ""
Write-Host "✅ SkyWatch Agent installed!" -ForegroundColor Green
Write-Host "   Logs:      Get-Content '$InstallDir\agent.log' -Wait"
Write-Host "   Status:    Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "   Uninstall: .\install-agent-windows.ps1 -Uninstall"
Write-Host ""
Write-Host "The agent will register with $ServerUrl and appear in your"
Write-Host "SkyWatch dashboard within a minute."
