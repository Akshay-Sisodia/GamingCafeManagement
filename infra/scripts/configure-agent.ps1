# Configure an installed GamingCafeAgent service.
# Run as Administrator on each café PC AFTER installing GamingCafeAgent.msi.
#
# Usage:
#   .\configure-agent.ps1 -PairingCode ABC123
#   .\configure-agent.ps1 -ServerUrl "https://gcm-api.onrender.com" -PairingCode XYZ789

param(
    [string]$ServerUrl = "https://gcm-api.onrender.com",
    [Parameter(Mandatory = $true)]
    [string]$PairingCode
)

$ErrorActionPreference = "Stop"

$regPath = "HKLM:\SOFTWARE\GamingCafe\Agent"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "ServerBaseUrl" -Value $ServerUrl
Set-ItemProperty -Path $regPath -Name "PairingCode" -Value $PairingCode

Write-Host "Configured: server=$ServerUrl pairing=$PairingCode"

Restart-Service -Name "GamingCafeAgent" -ErrorAction SilentlyContinue
Write-Host "Service restarted. Watch the dashboard — this PC should go online within a minute."
