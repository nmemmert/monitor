#Requires -Version 5.1
<#
.SYNOPSIS
    SkyWatch Windows Agent v1.0.0
.DESCRIPTION
    Collects system metrics and sends to SkyWatch monitoring server.
    Metrics: CPU%, Memory, Disk, Network I/O, Process count, Uptime, OS info.
    Run via Task Scheduler (installed by install-agent-windows.ps1).
.PARAMETER ConfigFile
    Path to the configuration file (default: C:\ProgramData\SkyWatch\agent.conf)
#>
param(
    [string]$ConfigFile = "C:\ProgramData\SkyWatch\agent.conf"
)

$VERSION   = "1.0.0"
$LogFile   = "C:\ProgramData\SkyWatch\agent.log"
$InstallDir = Split-Path $ConfigFile

# ── Logging ───────────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message)
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Message"
    Write-Host $line
    try { Add-Content -Path $LogFile -Value $line -ErrorAction Stop } catch {}
}

# ── Config ────────────────────────────────────────────────────────────────────

function Load-Config {
    $script:SKYWATCH_URL      = ""
    $script:AGENT_TOKEN       = ""
    $script:REPORT_INTERVAL   = 60
    $script:AGENT_NAME        = ""
    $script:REGISTRATION_KEY  = ""

    if (Test-Path $ConfigFile) {
        Get-Content $ConfigFile | ForEach-Object {
            if ($_ -match '^([A-Z_]+)="?(.*?)"?\s*$') {
                $key = $matches[1]; $val = $matches[2]
                switch ($key) {
                    "SKYWATCH_URL"     { $script:SKYWATCH_URL    = $val }
                    "AGENT_TOKEN"      { $script:AGENT_TOKEN     = $val }
                    "REPORT_INTERVAL"  { $script:REPORT_INTERVAL = [int]$val }
                    "AGENT_NAME"       { $script:AGENT_NAME      = $val }
                    "REGISTRATION_KEY" { $script:REGISTRATION_KEY = $val }
                }
            }
        }
    }
}

function Save-Config {
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    @"
SKYWATCH_URL="$script:SKYWATCH_URL"
AGENT_TOKEN="$script:AGENT_TOKEN"
REPORT_INTERVAL=$script:REPORT_INTERVAL
AGENT_NAME="$script:AGENT_NAME"
REGISTRATION_KEY="$script:REGISTRATION_KEY"
"@ | Set-Content $ConfigFile -Encoding UTF8
}

# ── Metrics ───────────────────────────────────────────────────────────────────

function Get-CpuPercent {
    try {
        # Two raw counter samples 1 second apart for accurate delta
        $s1 = Get-CimInstance -ClassName Win32_PerfRawData_PerfOS_Processor -Filter "Name='_Total'"
        Start-Sleep -Seconds 1
        $s2 = Get-CimInstance -ClassName Win32_PerfRawData_PerfOS_Processor -Filter "Name='_Total'"

        $idleDelta  = $s2.PercentIdleTime  - $s1.PercentIdleTime
        $totalDelta = $s2.Timestamp_Sys100NS - $s1.Timestamp_Sys100NS

        if ($totalDelta -gt 0) {
            $idlePct = ($idleDelta / $totalDelta) * 100
            return [Math]::Round(100 - $idlePct, 1)
        }
    } catch {}

    # Fallback: WMI LoadPercentage (less accurate but always available)
    try {
        $avg = (Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        return [Math]::Round($avg, 1)
    } catch { return 0.0 }
}

function Get-MemoryStats {
    try {
        $os      = Get-CimInstance Win32_OperatingSystem
        $totalMB = [long][Math]::Round($os.TotalVisibleMemorySize / 1024)
        $freeMB  = [long][Math]::Round($os.FreePhysicalMemory / 1024)
        $usedMB  = $totalMB - $freeMB
        $pct     = if ($totalMB -gt 0) { [Math]::Round($usedMB * 100.0 / $totalMB, 1) } else { 0.0 }
        return @{ total = $totalMB; used = $usedMB; percent = $pct }
    } catch {
        return @{ total = 0; used = 0; percent = 0.0 }
    }
}

function Get-DiskStats {
    $disks = [System.Collections.Generic.List[hashtable]]::new()
    try {
        Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\' } | ForEach-Object {
            $total  = $_.Used + $_.Free
            $totalMB = [long][Math]::Round($total / 1MB)
            $usedMB  = [long][Math]::Round($_.Used / 1MB)
            $pct     = if ($total -gt 0) { [int][Math]::Round($_.Used * 100.0 / $total) } else { 0 }
            $disks.Add(@{ path = $_.Root; total_mb = $totalMB; used_mb = $usedMB; percent = $pct })
        }
    } catch {}
    return $disks
}

function Get-NetBytes {
    try {
        $up = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -ExpandProperty Name
        if ($up) {
            $stats = Get-NetAdapterStatistics -Name $up -ErrorAction SilentlyContinue
            $sent  = ($stats | Measure-Object -Property SentBytes     -Sum).Sum
            $recv  = ($stats | Measure-Object -Property ReceivedBytes -Sum).Sum
            return @{ sent = [long]$sent; recv = [long]$recv }
        }
    } catch {}
    return @{ sent = 0L; recv = 0L }
}

function Get-UptimeSeconds {
    try {
        $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
        return [long](New-TimeSpan -Start $boot -End (Get-Date)).TotalSeconds
    } catch { return 0L }
}

function Get-OsInfo {
    try { return (Get-CimInstance Win32_OperatingSystem).Caption.Trim() }
    catch { return "Windows" }
}

function Get-PrimaryIP {
    try {
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
                 Sort-Object RouteMetric | Select-Object -First 1
        if ($route) {
            $ip = Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                  Where-Object { $_.IPAddress -notmatch '^169\.254\.' } |
                  Select-Object -First 1 -ExpandProperty IPAddress
            return "$ip"
        }
    } catch {}
    return ""
}

# ── Registration ──────────────────────────────────────────────────────────────

function Register-Agent {
    $name     = if ($script:AGENT_NAME) { $script:AGENT_NAME } else { $env:COMPUTERNAME }
    $hostname = $env:COMPUTERNAME
    $ip       = Get-PrimaryIP
    $os       = Get-OsInfo

    Write-Log "Registering agent '$name' with $script:SKYWATCH_URL ..."

    $body    = @{ name = $name; hostname = $hostname; ip_address = $ip; os_info = $os } | ConvertTo-Json
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($script:REGISTRATION_KEY) { $headers['X-Registration-Key'] = $script:REGISTRATION_KEY }

    try {
        $resp = Invoke-RestMethod -Uri "$script:SKYWATCH_URL/api/agents/register" `
                                  -Method POST -Body $body -Headers $headers -TimeoutSec 30
        if ($resp.token) {
            $script:AGENT_TOKEN = $resp.token
            Save-Config
            Write-Log "Registered. Token stored in $ConfigFile"
            return $true
        }
    } catch { Write-Log "ERROR: Registration failed: $_" }
    return $false
}

# ── Metrics report ────────────────────────────────────────────────────────────

function Send-Metrics {
    $cpu    = Get-CpuPercent         # includes 1s sleep
    $mem    = Get-MemoryStats
    $disks  = Get-DiskStats
    $net    = Get-NetBytes
    $uptime = Get-UptimeSeconds
    $procs  = try { (Get-Process -ErrorAction SilentlyContinue).Count } catch { 0 }
    $ip     = Get-PrimaryIP

    $payload = [ordered]@{
        cpu_percent    = $cpu
        mem_total      = $mem.total
        mem_used       = $mem.used
        mem_percent    = $mem.percent
        disk           = @($disks)
        load_1         = 0.0
        load_5         = 0.0
        load_15        = 0.0
        uptime_seconds = $uptime
        process_count  = $procs
        net_bytes_sent = $net.sent
        net_bytes_recv = $net.recv
        ip_address     = $ip
    } | ConvertTo-Json -Depth 3

    try {
        $resp = Invoke-RestMethod `
            -Uri     "$script:SKYWATCH_URL/api/agents/report" `
            -Method  POST `
            -Body    $payload `
            -Headers @{ 'Content-Type' = 'application/json'; 'Authorization' = "Bearer $script:AGENT_TOKEN" } `
            -TimeoutSec 15

        if ($resp.ok) {
            Write-Log "OK  cpu=$($cpu)%  mem=$($mem.used)/$($mem.total)MB  procs=$procs"
        } else {
            Write-Log "WARNING: Server rejected metrics"
        }
    } catch {
        Write-Log "WARNING: Failed to send metrics: $_"
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────

# Ensure log directory exists
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }

Load-Config

if (-not $script:SKYWATCH_URL) {
    Write-Error "SKYWATCH_URL is not set. Edit $ConfigFile or re-run the installer."
    exit 1
}

if (-not $script:AGENT_TOKEN) {
    if (-not (Register-Agent)) {
        Write-Log "Retrying registration in 60s ..."
        Start-Sleep -Seconds 60
        if (-not (Register-Agent)) { exit 1 }
    }
}

$interval = if ($script:REPORT_INTERVAL -gt 0) { $script:REPORT_INTERVAL } else { 60 }
Write-Log "SkyWatch Agent v$VERSION started (Windows) — server=$script:SKYWATCH_URL  interval=${interval}s"

while ($true) {
    Send-Metrics
    Start-Sleep -Seconds ($interval - 1)   # -1 accounts for the 1s CPU sample sleep
}
