# Kiosk provisioning script — run as Administrator on a gaming PC.
# Creates the locked-down kiosk user, applies NTFS execute ACLs, and sets up
# auto-login. Complements PcAgent.Core KioskController registry policies.
#
# Usage: .\provision-kiosk.ps1 -LauncherPath "C:\Program Files\GamingCafe\GamingLauncher.exe"

param(
    [string]$KioskUser = "gaming-kiosk",
    [Parameter(Mandatory = $true)]
    [string]$LauncherPath
)

$ErrorActionPreference = "Stop"

# ---- 1. Create kiosk user (non-admin) --------------------------------------
if (-not (Get-LocalUser -Name $KioskUser -ErrorAction SilentlyContinue)) {
    $randomBytes = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $plainPassword = ([Convert]::ToBase64String($randomBytes) -replace "[/+=]", "a")
    $password = ConvertTo-SecureString $plainPassword -AsPlainText -Force
    New-LocalUser -Name $KioskUser -Password $password -AccountNeverExpires -PasswordNeverExpires |
        Out-Null
    Write-Host "Created local user '$KioskUser' (generated password stored nowhere — reset with Set-LocalUser if needed)"
}

$usersGroup = (Get-LocalGroup -SID "S-1-5-32-545").Name   # Users
$adminsGroup = (Get-LocalGroup -SID "S-1-5-32-544").Name  # Administrators
Add-LocalGroupMember -Group $usersGroup -Member $KioskUser -ErrorAction SilentlyContinue

# Safety: ensure the kiosk user is NOT an administrator.
$adminMembers = Get-LocalGroupMember -Group $adminsGroup | Where-Object { $_.Name -like "*$KioskUser*" }
if ($adminMembers) {
    Remove-LocalGroupMember -Group $adminsGroup -Member $KioskUser
    Write-Warning "Removed '$KioskUser' from Administrators"
}

# ---- 2. NTFS execute ACLs: deny kiosk user on dangerous executables --------
$system32 = "$env:SystemRoot\System32"
$blockedExecutables = @(
    "cmd.exe", "powershell.exe", "pwsh.exe", "regedit.exe", "mmc.exe",
    "taskmgr.exe", "msconfig.exe", "wscript.exe", "cscript.exe"
)
foreach ($exe in $blockedExecutables) {
    $path = Join-Path $system32 $exe
    if (Test-Path $path) {
        # Deny Execute after allowing Read (UI may still show icons).
        icacls $path /deny "${KioskUser}:(X)" | Out-Null
        Write-Host "Denied execute on $exe for $KioskUser"
    }
}
# WindowsApps + Windows Defender folder hardening is inherited via policy.

# ---- 3. Auto-login for the kiosk user ---------------------------------------
$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -Value "1"
Set-ItemProperty -Path $winlogon -Name "DefaultUserName" -Value $KioskUser
# NOTE: DefaultPassword stored in clear text is required for AutoAdminLogon.
# For hardened deployments use Autologon.exe (Sysinternals) which stores LSA secret.
Write-Warning "AutoAdminLogon enabled for '$KioskUser'. Set 'DefaultPassword' or use Sysinternals Autologon."

# ---- 4. Custom shell for the kiosk user -------------------------------------
# Per-user custom shell (applies when this user logs on):
$userSid = (New-Object System.Security.Principal.NTAccount($env:COMPUTERNAME, $KioskUser)).Translate(
    [System.Security.Principal.SecurityIdentifier]).Value
$profileList = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$userSid"
if (-not (Test-Path $profileList)) {
    Write-Warning "ProfileList key not found yet for '$KioskUser' (log in once, then re-run steps 3-4)."
} else {
    $profilePath = (Get-ItemProperty -Path $profileList).ProfileImagePath
    $userWinlogon = "HKEY_USERS\$userSid\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Write-Host @"
Custom shell must be set inside the user's hive:
  reg load HKU\KioskTmp "$profilePath\NTUSER.DAT"
  reg add HKU\KioskTmp\Software\Microsoft\Windows NT\CurrentVersion\Winlogon /v Shell /t REG_SZ /d "$LauncherPath" /f
  reg unload HKU\KioskTmp
(The PcAgent KioskController also sets Shell= at each kiosk logon.)
"@
}

# ---- 5. USB autoplay off -----------------------------------------------------
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" `
    -Name "NoDriveTypeAutoRun" -Value 0xFF -Type DWord -ErrorAction SilentlyContinue

Write-Host "`nProvisioning complete. Reboot and verify the kiosk session starts into the launcher." -ForegroundColor Green
