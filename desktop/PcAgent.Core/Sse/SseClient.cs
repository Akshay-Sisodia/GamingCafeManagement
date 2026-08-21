using System.Net;
using System.Text;
using System.Text.Json;

namespace PcAgent.Core.Sse;

public sealed record SseEvent(string? Id, string EventName, string Data);

/// <summary>
/// Minimal SSE client over HttpClient streaming (docs/03 §5). Parses
/// event/id/data lines incrementally, reconnects with jittered exponential
/// backoff, and sends Last-Event-ID on reconnect. Never throws unobserved.
/// </summary>
public sealed class SseClient : IAsyncDisposable
{
    private readonly HttpClient _http;
    private readonly Func<CancellationToken, Task<HttpRequestMessage>> _requestFactory;
    private readonly Action<SseEvent> _onEvent;
    private readonly Action<string> _log;
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private string? _lastEventId;

    public bool IsConnected { get; private set; }
    public event Action<bool>? ConnectionChanged;
    /// <summary>Invoked when the server rejects our credentials (401) — caller should clear stored identity.</summary>
    public event Action? AuthRejected;

    public SseClient(Func<CancellationToken, Task<HttpRequestMessage>> requestFactory,
        Action<SseEvent> onEvent, Action<string>? log = null)
    {
        _http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "text/event-stream");
        _requestFactory = requestFactory;
        _onEvent = onEvent;
        _log = log ?? (_ => { });
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunLoopAsync(_cts.Token));
    }

    private async Task RunLoopAsync(CancellationToken ct)
    {
        var backoffMs = 1000;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var req = await _requestFactory(ct);
                if (_lastEventId is not null)
                {
                    req.Headers.TryAddWithoutValidation("Last-Event-ID", _lastEventId);
                }

                using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                resp.EnsureSuccessStatusCode();

                SetConnected(true);
                backoffMs = 1000;

                await using var stream = await resp.Content.ReadAsStreamAsync(ct);
                using var reader = new StreamReader(stream, Encoding.UTF8);

                var eventName = "message";
                var dataBuilder = new StringBuilder();
                string? line;

                while ((line = await reader.ReadLineAsync(ct)) is not null)
                {
                    if (ct.IsCancellationRequested) break;

                    if (line.Length == 0)
                    {
                        // Blank line dispatches the accumulated event.
                        if (dataBuilder.Length > 0)
                        {
                            var ev = new SseEvent(null, eventName, dataBuilder.ToString());
                            _onEvent(ev);
                        }
                        eventName = "message";
                        dataBuilder.Clear();
                        continue;
                    }

                    if (line.StartsWith(':')) continue; // heartbeat comment

                    if (line.StartsWith("id:"))
                    {
                        _lastEventId = line["id:".Length..].Trim();
                    }
                    else if (line.StartsWith("event:"))
                    {
                        eventName = line["event:".Length..].Trim();
                    }
                    else if (line.StartsWith("data:"))
                    {
                        dataBuilder.AppendLine(line["data:".Length..].TrimStart());
                    }
                    else if (line.StartsWith("retry:"))
                    {
                        // Server-suggested retry; we keep our own backoff policy.
                    }
                }

                SetConnected(false); // stream ended
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (HttpRequestException hre) when (hre.StatusCode == HttpStatusCode.Unauthorized)
            {
                // Server rejected our credentials — stored identity is stale
                // (e.g. PC record deleted). Caller clears it; next loop re-enrolls.
                SetConnected(false);
                AuthRejected?.Invoke();
                _log("SSE rejected: credentials invalid (401)");
                await Task.Delay(backoffMs + Random.Shared.Next(0, 500), ct);
                backoffMs = Math.Min(backoffMs * 2, 30_000);
            }
            catch (Exception ex)
            {
                SetConnected(false);
                _log($"SSE disconnected: {ex.Message}");
            }

            try
            {
                var jitter = Random.Shared.Next(0, 500);
                await Task.Delay(backoffMs + jitter, ct);
            }
            catch (OperationCanceledException) { break; }

            backoffMs = Math.Min(backoffMs * 2, 30_000);
        }
    }

    private void SetConnected(bool connected)
    {
        if (IsConnected == connected) return;
        IsConnected = connected;
        ConnectionChanged?.Invoke(connected);
    }

    public async ValueTask DisposeAsync()
    {
        _cts?.Cancel();
        if (_loop is not null)
        {
            try { await _loop.WaitAsync(TimeSpan.FromSeconds(3)); } catch { /* ignore */ }
        }
        _http.Dispose();
        _cts?.Dispose();
    }
}
