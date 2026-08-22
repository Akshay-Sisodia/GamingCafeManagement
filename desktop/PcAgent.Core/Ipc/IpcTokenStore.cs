using System.Security.Cryptography;

namespace PcAgent.Core.Ipc;

/// <summary>Shared launcher↔agent IPC secret — persisted so restarts stay paired.</summary>
public static class IpcTokenStore
{
    public const string TokenFileName = "ipc.token";

    public static string DefaultDataDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GamingCafe", "Agent");

    public static string LoadOrCreate(string dataDirectory)
    {
        var path = Path.Combine(dataDirectory, TokenFileName);
        if (File.Exists(path))
        {
            var existing = File.ReadAllText(path).Trim();
            if (existing.Length >= 32) return existing;
        }

        Directory.CreateDirectory(dataDirectory);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        File.WriteAllText(path, token);
        return token;
    }

    public static string? TryLoad(string? dataDirectory = null)
    {
        var path = Path.Combine(dataDirectory ?? DefaultDataDirectory, TokenFileName);
        if (!File.Exists(path)) return null;
        var token = File.ReadAllText(path).Trim();
        return token.Length >= 32 ? token : null;
    }
}
