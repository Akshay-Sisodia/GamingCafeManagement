using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PcAgent.Core.Deployment;

public sealed record DeploymentJobInfo(
    string JobId,
    string GameId,
    string Version,
    string LanBaseUrl,
    string? ManifestHash,
    long SizeBytes,
    string TargetState);

/// <summary>Progress reported by the deployment client.</summary>
public sealed record DeploymentProgress(
    string State,        // downloading | verifying | installing | paused | ready | failed
    double ProgressPct,
    long BytesTransferred,
    string? Error = null);

/// <summary>
/// Target-side LAN pull client (docs/04 §7): preflight → chunked ranged
/// download (throttled, low priority) → SHA-256 verify per file.
/// Honors pause/resume via the injected gate; never marks READY unverified.
/// </summary>
public sealed class DeploymentClient
{
    private readonly HttpClient _http;
    private readonly Func<bool> _isPaused;          // session started / admin pause / window closed
    private readonly Func<long> _maxBytesPerSecond; // 0 = unlimited
    private readonly Action<string> _log;

    public DeploymentClient(Func<bool> isPaused, Func<long> maxBytesPerSecond, Action<string>? log = null)
    {
        _http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        _isPaused = isPaused;
        _maxBytesPerSecond = maxBytesPerSecond;
        _log = log ?? (_ => { });
    }

    /// <summary>
    /// Runs one deployment to completion. Returns final state; caller reports
    /// progress/complete/fail to the cloud.
    /// </summary>
    public async Task<DeploymentProgress> RunAsync(
        DeploymentJobInfo job, string installRoot, CancellationToken ct)
    {
        try
        {
            // ---- preflight -------------------------------------------------
            var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(installRoot))!);
            if (drive.AvailableFreeSpace < job.SizeBytes + 5L * 1024 * 1024 * 1024)
            {
                return new DeploymentProgress("failed", 0, 0, "BLOCKED_DISK");
            }

            // ---- manifest ----------------------------------------------------
            var manifestUrl = $"{job.LanBaseUrl.TrimEnd('/')}/manifest.json?token={Uri.EscapeDataString(TokenFor(job))}";
            using var manifestResp = await _http.GetAsync(manifestUrl, ct);
            manifestResp.EnsureSuccessStatusCode();
            var manifest = DeploymentManifest.FromJson(await manifestResp.Content.ReadAsStringAsync(ct))
                ?? throw new InvalidOperationException("invalid manifest");

            if (!string.IsNullOrEmpty(job.ManifestHash) &&
                !string.Equals(manifest.Sha256OfListing(), job.ManifestHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("manifest hash mismatch");
            }

            // ---- download ------------------------------------------------------
            long doneBytes = 0;
            foreach (var file in manifest.Files)
            {
                while (_isPaused() && !ct.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                }
                if (ct.IsCancellationRequested) return new DeploymentProgress("paused", Pct(doneBytes, manifest.TotalBytes), doneBytes);

                var destPath = Path.Combine(installRoot, file.RelativePath.Replace('/', '\\'));
                Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);

                await DownloadFileAsync(job, file, destPath, ct);

                // ---- verify per file -----------------------------------------
                var actual = await Task.Run(() => DeploymentManifest.Sha256File(destPath), ct);
                if (!string.Equals(actual, file.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(destPath);
                    return new DeploymentProgress("failed", Pct(doneBytes, manifest.TotalBytes), doneBytes, "HASH_MISMATCH");
                }

                doneBytes += file.SizeBytes;
                _log($"deployed {file.RelativePath} ({Pct(doneBytes, manifest.TotalBytes):0}%)");
            }

            return new DeploymentProgress("ready", 100, doneBytes);
        }
        catch (OperationCanceledException)
        {
            return new DeploymentProgress("paused", 0, 0);
        }
        catch (Exception ex)
        {
            _log($"deployment failed: {ex.Message}");
            return new DeploymentProgress("failed", 0, 0, ex.Message.Length > 60 ? "DOWNLOAD_FAILED" : ex.Message);
        }
    }

    private async Task DownloadFileAsync(DeploymentJobInfo job, ManifestFile file, string destPath, CancellationToken ct)
    {
        var url = $"{job.LanBaseUrl.TrimEnd('/')}/content/{file.RelativePath}?token={Uri.EscapeDataString(TokenFor(job))}";

        // Resume support: continue from existing partial file.
        var existing = File.Exists(destPath) ? new FileInfo(destPath).Length : 0;
        if (existing > file.SizeBytes)
        {
            File.Delete(destPath);
            existing = 0;
        }

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (existing > 0) req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(existing, null);

        using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (existing > 0 && resp.StatusCode == System.Net.HttpStatusCode.RequestedRangeNotSatisfiable)
        {
            return; // already complete
        }
        resp.EnsureSuccessStatusCode();

        await using var network = await resp.Content.ReadAsStreamAsync(ct);
        await using var output = new FileStream(destPath, FileMode.Append, FileAccess.Write, FileShare.None, 1 << 20);

        var buffer = new byte[1 << 20];
        var throttle = _maxBytesPerSecond();
        var stopwatch = Stopwatch.StartNew();
        long writtenThisSecond = 0;

        int read;
        while ((read = await network.ReadAsync(buffer, ct)) > 0)
        {
            await output.WriteAsync(buffer.AsMemory(0, read), ct);
            writtenThisSecond += read;

            if (throttle > 0 && writtenThisSecond >= throttle)
            {
                var elapsedMs = stopwatch.ElapsedMilliseconds;
                var targetMs = writtenThisSecond * 1000 / throttle;
                if (elapsedMs < targetMs)
                {
                    await Task.Delay((int)(targetMs - elapsedMs), ct);
                }
                writtenThisSecond = 0;
                stopwatch.Restart();
            }
        }
    }

    private static string TokenFor(DeploymentJobInfo job) =>
        Environment.GetEnvironmentVariable($"DEPLOY_TOKEN_{job.JobId[..8]}") ?? "dev-token";

    private static double Pct(long done, long total) => total > 0 ? 100.0 * done / total : 0;
}

internal static class ManifestExtensions
{
    /// <summary>Deterministic hash over the file listing for tamper detection.</summary>
    public static string Sha256OfListing(this DeploymentManifest manifest)
    {
        var listing = string.Join("\n", manifest.Files
            .OrderBy(f => f.RelativePath)
            .Select(f => $"{f.RelativePath}:{f.SizeBytes}:{f.Sha256}"));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(listing))).ToLowerInvariant();
    }
}
