using System.Net;
using System.Text;
using PcAgent.Core.Deployment;

namespace PcAgent.Core.Deployment;

/// <summary>
/// Master-PC LAN content host (docs/04 §7). Serves manifests and byte-range
/// content from a repository directory over HttpListener — no extra deps.
/// Requires the per-job token as ?token= on every request.
/// Typical prefix: http://+:7300/
/// </summary>
public sealed class ContentServer : IDisposable
{
    private readonly string _repositoryRoot;
    private readonly Func<string, bool> _tokenValidator; // per-job scoped tokens
    private readonly Action<string> _log;
    private readonly CancellationTokenSource _cts = new();
    private HttpListener? _listener;

    public ContentServer(string repositoryRoot, Func<string, bool> tokenValidator, Action<string>? log = null)
    {
        _repositoryRoot = Path.GetFullPath(repositoryRoot);
        _tokenValidator = tokenValidator;
        _log = log ?? (_ => { });
    }

    public void Start(string prefix = "http://+:7300/")
    {
        _listener = new HttpListener();
        _listener.Prefixes.Add(prefix);
        _listener.Start();
        _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
        _log($"content server listening on {prefix} serving {_repositoryRoot}");
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var ctx = await _listener!.GetContextAsync();
                _ = Task.Run(() => HandleAsync(ctx, ct), ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log($"content server error: {ex.Message}");
            }
        }
    }

    private async Task HandleAsync(HttpListenerContext ctx, CancellationToken ct)
    {
        try
        {
            var token = ctx.Request.QueryString["token"];
            if (token is null || !_tokenValidator(token))
            {
                ctx.Response.StatusCode = 401;
                ctx.Response.Close();
                return;
            }

            var rawPath = Uri.UnescapeDataString(ctx.Request.Url?.AbsolutePath ?? "/");
            // /manifest.json | /content/<relative path>
            if (rawPath == "/manifest.json")
            {
                var manifestPath = Path.Combine(_repositoryRoot, "manifest.json");
                if (!File.Exists(manifestPath))
                {
                    ctx.Response.StatusCode = 404;
                    ctx.Response.Close();
                    return;
                }
                var bytes = await File.ReadAllBytesAsync(manifestPath, ct);
                ctx.Response.ContentType = "application/json";
                ctx.Response.ContentLength64 = bytes.Length;
                await ctx.Response.OutputStream.WriteAsync(bytes, ct);
                ctx.Response.Close();
                return;
            }

            if (rawPath.StartsWith("/content/", StringComparison.Ordinal))
            {
                var rel = rawPath["/content/".Length..];
                var full = Path.GetFullPath(Path.Combine(_repositoryRoot, rel.Replace('/', '\\')));
                if (!full.StartsWith(_repositoryRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
                {
                    ctx.Response.StatusCode = 404;
                    ctx.Response.Close();
                    return;
                }

                ServeWithRanges(ctx, full, ct);
                return;
            }

            ctx.Response.StatusCode = 404;
            ctx.Response.Close();
        }
        catch (Exception ex)
        {
            _log($"request failed: {ex.Message}");
            try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { }
        }
    }

    private static void ServeWithRanges(HttpListenerContext ctx, string filePath, CancellationToken ct)
    {
        var length = new FileInfo(filePath).Length;
        ctx.Response.Headers["Accept-Ranges"] = "bytes";
        ctx.Response.ContentType = "application/octet-stream";

        var rangeHeader = ctx.Request.Headers["Range"];
        long start = 0, end = length - 1;

        if (!string.IsNullOrEmpty(rangeHeader))
        {
            // bytes=start-end (single range only — sufficient for our client)
            var match = System.Text.RegularExpressions.Regex.Match(rangeHeader, @"bytes=(\d*)-(\d*)");
            if (match.Success)
            {
                if (long.TryParse(match.Groups[1].Value, out var s)) start = s;
                if (long.TryParse(match.Groups[2].Value, out var e) && e < length) end = e;
                if (match.Groups[2].Value.Length == 0) end = length - 1;
            }
            ctx.Response.StatusCode = 206;
            ctx.Response.Headers["Content-Range"] = $"bytes {start}-{end}/{length}";
        }
        else
        {
            ctx.Response.StatusCode = 200;
        }

        ctx.Response.ContentLength64 = end - start + 1;

        using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 1 << 20, useAsync: true);
        fs.Seek(start, SeekOrigin.Begin);

        var buffer = new byte[1 << 20]; // 1 MB chunks
        var remaining = end - start + 1;
        while (remaining > 0 && !ct.IsCancellationRequested)
        {
            var toRead = (int)Math.Min(buffer.Length, remaining);
            var read = fs.Read(buffer, 0, toRead);
            if (read <= 0) break;
            ctx.Response.OutputStream.Write(buffer, 0, read);
            remaining -= read;
        }
        ctx.Response.Close();
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener?.Stop(); _listener?.Close(); } catch { }
        _cts.Dispose();
    }
}
