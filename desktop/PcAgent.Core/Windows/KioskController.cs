using Microsoft.Win32;

namespace PcAgent.Core.Windows;

/// <summary>
/// Customer Mode lockdown per docs/04 §5: registry policy layer applied to the
/// kiosk user's hive. Combined with (a) custom shell replacement, (b) NTFS ACL
/// removal on blocked executables, and (c) AppLocker/WDAC where the SKU
/// supports it. See infra/scripts/provision-kiosk.ps1 for account setup.
/// </summary>
public sealed class KioskController
{
    private const string PoliciesKey = @"Software\Microsoft\Windows\CurrentVersion\Policies";
    private readonly string _kioskUserName;
    private readonly Action<string> _log;

    public KioskController(string kioskUserName, Action<string>? log = null)
    {
        _kioskUserName = kioskUserName;
        _log = log ?? (_ => { });
    }

    /// <summary>Applies all lockdown policies for the kiosk user.</summary>
    public void Apply()
    {
        ApplyToCurrentUser();
        _log("kiosk lockdown applied");
    }

    /// <summary>
    /// Applies policies to the CURRENT user hive. Run inside the kiosk user's
    /// session (the service invokes it via launcher bootstrap or logon script).
    /// </summary>
    public void ApplyToCurrentUser()
    {
        // Block Task Manager, Command Prompt, Control Panel, Run dialog, registry tools.
        SetPolicy($@"{PoliciesKey}\System", "DisableTaskMgr", 1);
        SetPolicy($@"{PoliciesKey}\System", "DisableCMD", 1);
        SetPolicy($@"{PoliciesKey}\System", "DisableRegistryTools", 1);
        SetPolicy($@"{PoliciesKey}\Explorer", "NoControlPanel", 1);
        SetPolicy($@"{PoliciesKey}\Explorer", "NoRun", 1);
        SetPolicy($@"{PoliciesKey}\Explorer", "NoSetTaskbar", 1);
        SetPolicy($@"{PoliciesKey}\Explorer", "NoViewOnDrive", 0x03FFFFFF); // hide all drives in Explorer
        SetPolicy($@"{PoliciesKey}\Explorer", "NoTrayContextMenu", 1);
        SetPolicy($@"{PoliciesKey}\Explorer", "NoWinKeys", 1);

        // DisallowRun list: explicit executable blocklist (defense in depth).
        using (var explorer = Registry.CurrentUser.CreateSubUserKey($@"{PoliciesKey}\Explorer"))
        {
            explorer.SetValue("DisallowRun", 1, RegistryValueKind.DWord);
            using var disallow = explorer.CreateSubKey("DisallowRun");
            var blocked = new[]
            {
                "cmd.exe", "powershell.exe", "pwsh.exe", "regedit.exe", "mmc.exe",
                "taskmgr.exe", "explorer.exe", "msconfig.exe", "control.exe",
                "wt.exe", "conhost.exe", "bash.exe", "wsl.exe",
            };
            for (var i = 0; i < blocked.Length; i++)
            {
                disallow.SetValue($"{i + 1}", blocked[i], RegistryValueKind.String);
            }
        }

        // Custom shell: replace Explorer with the Gaming Launcher for this user.
        using (var winlogon = Registry.CurrentUser.CreateSubUserKey(
                   @"Software\Microsoft\Windows NT\CurrentVersion\Winlogon"))
        {
            winlogon.SetValue("Shell", "GamingLauncher.exe", RegistryValueKind.String);
        }
    }

    /// <summary>Removes all policies (superadmin maintenance exit).</summary>
    public void RemoveAll()
    {
        try { Registry.CurrentUser.DeleteSubKeyTree($@"{PoliciesKey}\System", false); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree($@"{PoliciesKey}\Explorer", false); } catch { }
        using (var winlogon = Registry.CurrentUser.OpenSubKey(
                   @"Software\Microsoft\Windows NT\CurrentVersion\Winlogon", writable: true))
        {
            winlogon?.DeleteValue("Shell", throwOnMissingValue: false);
        }
        _log("kiosk lockdown removed");
    }

    private static void SetPolicy(string subKey, string name, int value)
    {
        using var key = Registry.CurrentUser.CreateSubUserKey(subKey);
        key.SetValue(name, value, RegistryValueKind.DWord);
    }
}

internal static class RegistryKioskExtensions
{
    /// <summary>CreateSubKey that tolerates our helper naming.</summary>
    public static RegistryKey CreateSubUserKey(this RegistryKey key, string subkey) =>
        key.CreateSubKey(subkey, writable: true);
}
