# Profiles PcAgent + GamingLauncher against docs/04-pc-agent.md budgets.
# Usage: .\profile-desktop.ps1 [-DurationSec 120] [-AgentPid 0]
param(
    [int] $DurationSec = 120,
    [int] $IntervalSec = 5,
    [int] $AgentPid = 0
)

$cores = [Environment]::ProcessorCount

function Find-AgentPid {
    Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" |
        Where-Object { $_.CommandLine -match 'PcAgent\.dll' } |
        Select-Object -First 1 -ExpandProperty ProcessId
}

function Get-ProcStats([int] $processId) {
    $p = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    return @{
        Cpu = $p.CPU
        WS_MB = [math]::Round($p.WorkingSet64 / 1MB, 1)
        Priv_MB = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    }
}

if ($AgentPid -eq 0) { $AgentPid = Find-AgentPid }
if (-not $AgentPid) {
    Write-Error "PcAgent not running (dotnet PcAgent.dll). Start it first."
    exit 1
}

$launcherPids = @(Get-Process -Name GamingLauncher -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$samples = @()
$iterations = [math]::Floor($DurationSec / $IntervalSec)

$agentStart = Get-ProcStats $AgentPid
$launcherStart = $launcherPids | ForEach-Object { Get-ProcStats $_ }

for ($i = 0; $i -lt $iterations; $i++) {
    Start-Sleep -Seconds $IntervalSec
    $a = Get-ProcStats $AgentPid
    $ls = $launcherPids | ForEach-Object { Get-ProcStats $_ }
    $launcherWs = ($ls | Where-Object { $_ } | ForEach-Object { $_.WS_MB } | Measure-Object -Sum).Sum
    $launcherPriv = ($ls | Where-Object { $_ } | ForEach-Object { $_.Priv_MB } | Measure-Object -Sum).Sum
    $samples += [pscustomobject]@{
        T = ($i + 1) * $IntervalSec
        Agent_WS_MB = $a.WS_MB
        Launcher_WS_MB = $launcherWs
        Launcher_Priv_MB = $launcherPriv
    }
}

$agentEnd = Get-ProcStats $AgentPid
$cpuAvgPct = if ($agentStart -and $agentEnd) {
    100 * ($agentEnd.Cpu - $agentStart.Cpu) / ($DurationSec * $cores)
} else { 0 }

$report = [pscustomobject]@{
    Timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    Machine = $env:COMPUTERNAME
    Cores = $cores
    DurationSec = $DurationSec
    AgentPid = $AgentPid
    LauncherPids = ($launcherPids -join ',')
    Agent_CPU_Avg_Pct = [math]::Round($cpuAvgPct, 3)
    Agent_WS_MB_Start = $agentStart.WS_MB
    Agent_WS_MB_End = $agentEnd.WS_MB
    Agent_Priv_MB_End = $agentEnd.Priv_MB
    Agent_WS_MB_Max = ($samples | Where-Object { $_.Agent_WS_MB } | Measure-Object -Property Agent_WS_MB -Maximum).Maximum
    Launcher_WS_MB_Start = ($launcherStart | ForEach-Object { $_.WS_MB } | Measure-Object -Sum).Sum
    Launcher_WS_MB_End = ($samples[-1].Launcher_WS_MB)
    Launcher_Priv_MB_End = ($samples[-1].Launcher_Priv_MB)
    Launcher_WS_MB_Max = ($samples | Where-Object { $_.Launcher_WS_MB } | Measure-Object -Property Launcher_WS_MB -Maximum).Maximum
    Launcher_Count = $launcherPids.Count
}

# PRD targets from docs/04-pc-agent.md + docs/05-milestones.md
$targets = @{
    Agent_CPU_Avg_Pct_Max = 0.5
    Agent_WS_MB_Target = 60
    Agent_WS_MB_Hard = 100
    Launcher_WS_MB_Idle_Max = 150
    Launcher_WS_MB_Gaming_Max = 40
}

$report | Add-Member -NotePropertyName Pass_Agent_CPU -NotePropertyValue ($report.Agent_CPU_Avg_Pct -lt $targets.Agent_CPU_Avg_Pct_Max)
$report | Add-Member -NotePropertyName Pass_Agent_RAM_Target -NotePropertyValue ($report.Agent_WS_MB_Max -le $targets.Agent_WS_MB_Target)
$report | Add-Member -NotePropertyName Pass_Agent_RAM_Hard -NotePropertyValue ($report.Agent_WS_MB_Max -le $targets.Agent_WS_MB_Hard)
$report | Add-Member -NotePropertyName Pass_Launcher_Idle_RAM -NotePropertyValue ($report.Launcher_WS_MB_Max -le $targets.Launcher_WS_MB_Idle_Max)

$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outFile = Join-Path $outDir "profile-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$report | ConvertTo-Json | Set-Content -Encoding utf8 $outFile

Write-Host "=== Desktop profile ($DurationSec s) ===" -ForegroundColor Cyan
$report | Format-List
Write-Host "Targets: CPU < $($targets.Agent_CPU_Avg_Pct_Max)% | Agent RAM <= $($targets.Agent_WS_MB_Target) MB (hard $($targets.Agent_WS_MB_Hard)) | Launcher idle <= $($targets.Launcher_WS_MB_Idle_Max) MB"
Write-Host "Saved: $outFile"
