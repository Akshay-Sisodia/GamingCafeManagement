using System.Security.Cryptography;
using System.Text.Json;

namespace PcAgent.Core.Deployment;

/// <summary>A single file entry in a deployment manifest.</summary>
public sealed record ManifestFile(string RelativePath, long SizeBytes, string Sha256);

/// <summary>
/// Game content manifest (docs/04 §7): file list + sizes + hashes.
/// Served by the master PC over LAN; verified by targets before READY.
/// </summary>
public sealed record DeploymentManifest(
    string GameId,
    string Version,
    long TotalBytes,
    IReadOnlyList<ManifestFile> Files)
{
    public string ToJson() => JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });

    public static DeploymentManifest? FromJson(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<DeploymentManifest>(json);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Builds a manifest by hashing every file under <paramref name="root"/>.</summary>
    public static DeploymentManifest BuildFromDirectory(string root, string gameId, string version)
    {
        var files = new List<ManifestFile>();
        foreach (var path in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(root, path).Replace('\\', '/');
            var fi = new FileInfo(path);
            files.Add(new ManifestFile(rel, fi.Length, Sha256File(path)));
        }
        return new DeploymentManifest(gameId, version, files.Sum(f => f.SizeBytes), files);
    }

    public static string Sha256File(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
