using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace GamingLauncher.Ipc;

/// <summary>
/// Wire contract with the PcAgent named-pipe server ("GamingCafeAgent").
/// Requests:  {"method":"bootstrap|session.start|session.extend|order.place|
///              superadmin.verify|game.launch|maintenance.action","payload":{...}}
/// Responses: {"ok":true,"data":{...}} | {"ok":false,"error":"..."}
/// Pushes:    {"type":"timer","data":{"remaining_seconds":N}}
///            {"type":"session","data":{"state":"active|none","expires_at":"..."}}
///            {"type":"games","data":{"items":[{game_id,name,executable_path,launch_args}]}}
///            {"type":"order_status","data":{"order_number":N,"status":"..."}}
/// The launcher is unprivileged — it holds no tokens; the agent proxies cloud calls.
/// </summary>
public static class IpcProtocol
{
    public const string PipeName = "GamingCafeAgent";

    public const string MethodBootstrap = "bootstrap";
    public const string MethodSessionStart = "session.start";
    public const string MethodSessionExtend = "session.extend";
    public const string MethodOrderPlace = "order.place";
    public const string MethodSuperadminVerify = "superadmin.verify";
    public const string MethodGameLaunch = "game.launch";
    public const string MethodMaintenanceAction = "maintenance.action";
}

public sealed record IpcPush(string Type, JsonElement Data);

/// <summary>Reconnecting named-pipe client. Never crashes when the agent is absent.</summary>
public sealed class NamedPipeIpcClient : IDisposable
{
    private NamedPipeClientStream? _pipe;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public bool IsConnected => _pipe?.IsConnected ?? false;
    public event Action<IpcPush>? PushReceived;
    public event Action<bool>? ConnectionChanged;

    public void Start() => _ = Task.Run(() => ConnectLoopAsync(_cts.Token));

    private async Task ConnectLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                _pipe = new NamedPipeClientStream(".", IpcProtocol.PipeName, PipeDirection.InOut);
                await _pipe.ConnectAsync(3000, ct);
                _reader = new StreamReader(_pipe, Encoding.UTF8, leaveOpen: true);
                _writer = new StreamWriter(_pipe, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };
                ConnectionChanged?.Invoke(true);

                while (!ct.IsCancellationRequested && _pipe.IsConnected)
                {
                    var line = await _reader.ReadLineAsync(ct);
                    if (line is null) break;
                    HandleMessage(line);
                }
                ConnectionChanged?.Invoke(false);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception)
            {
                ConnectionChanged?.Invoke(false);
            }

            try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { break; }
        }
    }

    private void HandleMessage(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.TryGetProperty("type", out var typeEl))
            {
                var push = new IpcPush(typeEl.GetString() ?? "",
                    root.TryGetProperty("data", out var d) ? d.Clone() : JsonSerializer.SerializeToElement(new { }));
                PushReceived?.Invoke(push);
            }
            // responses are consumed by SendRequestAsync via pending map (kept simple:
            // launcher sends one request at a time from UI thread)
        }
        catch
        {
            // malformed message — ignore
        }
    }

    /// <summary>Sends a request and waits for the response line.</summary>
    public async Task<JsonElement?> SendRequestAsync(string method, object? payload, CancellationToken ct = default)
    {
        if (!IsConnected) return null;
        var request = JsonSerializer.Serialize(new { method, payload });
        try
        {
            await _writeLock.WaitAsync(ct);
            try
            {
                await _writer!.WriteLineAsync(request.AsMemory(), ct);
                // Read response synchronously on a worker — responses interleave with pushes,
                // so scan until we see an ok/error envelope.
                while (!ct.IsCancellationRequested)
                {
                    var lineTask = _reader!.ReadLineAsync(ct);
                    var line = await lineTask;
                    if (line is null) return null;
                    using var doc = JsonDocument.Parse(line);
                    if (doc.RootElement.TryGetProperty("ok", out var ok))
                    {
                        return ok.GetBoolean()
                            ? doc.RootElement.TryGetProperty("data", out var data) ? data.Clone() : JsonSerializer.SerializeToElement(new { })
                            : null;
                    }
                    // else it was a push → dispatch
                    if (doc.RootElement.TryGetProperty("type", out var t))
                    {
                        PushReceived?.Invoke(new IpcPush(t.GetString() ?? "",
                            doc.RootElement.TryGetProperty("data", out var d2) ? d2.Clone() : JsonSerializer.SerializeToElement(new { })));
                    }
                }
                return null;
            }
            finally
            {
                _writeLock.Release();
            }
        }
        catch
        {
            return null;
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _pipe?.Dispose(); } catch { }
        _cts.Dispose();
        _writeLock.Dispose();
    }
}
