namespace PcAgent.Core.Options;

/// <summary>Agent configuration (appsettings.json "Agent" section).</summary>
public sealed class AgentOptions
{
    public const string SectionName = "Agent";

    public string ServerBaseUrl { get; set; } = "http://localhost:3000";
    public string LauncherPath { get; set; } = @"C:\Program Files\GamingCafe\GamingLauncher.exe";
    public string DataDirectory { get; set; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GamingCafe", "Agent");
    public int HealthIntervalIdleSeconds { get; set; } = 60;
    public int HealthIntervalGamingSeconds { get; set; } = 300;
    public int[] WarningMarksSeconds { get; set; } = [600, 300, 60];
    public int TimeSyncIntervalSeconds { get; set; } = 900;
    public double TamperDivergenceThresholdSeconds { get; set; } = 60;

    /// <summary>Optional pairing code provisioned per machine (registry/installer).</summary>
    public string? PairingCode { get; set; }

    /// <summary>Cafe-wide enrollment token — enables zero-touch MSI rollout.</summary>
    public string? EnrollToken { get; set; }
}
