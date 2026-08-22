using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace GamingLauncher.Ipc;

/// <summary>
/// Wire contract with the PcAgent named-pipe server ("GamingCafeAgent").
/// Requests:  {"method":"bootstrap|session.start|session.extend|order.place|
///              superadmin.verify|game.launch|maintenance.action","payload":{...}}
/// Responses: {"ok":true,"data":{...}} | {"ok":false,"error":"..."}
/// Pushes:    {"type":"timer","data":{"remaining_seconds":N}}
///            {"type":"session","data":{"state":"active|none","expires_at":"..."}}
///            {"type":"games","data":{"items":[{game_id,name,executable_path,launch_args,icon_url,category}]}}
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
    public const string MethodGamesScan = "games.scan";
    public const string MethodGamesImportDiscovered = "games.import_discovered";
    public const string MethodGamesAdd = "games.add";
    public const string MethodGamesRemove = "games.remove";
    public const string MethodGamesSetThumbnail = "games.set_thumbnail";
    public const string MethodGamesSetPath = "games.set_path";
    public const string MethodMaintenanceAction = "maintenance.action";
}

public sealed record IpcPush(string Type, JsonElement Data);

/// <summary>
/// Reconnecting named-pipe client. All pipe I/O runs on one session loop:
/// one reader, one in-flight request, queued outbound requests — no races.
/// </summary>
public sealed class NamedPipeIpcClient : IDisposable
{
    private sealed record PendingRequest(string Method, object? Payload, TaskCompletionSource<JsonElement?> Reply);

    private readonly CancellationTokenSource _cts = new();
    private readonly Channel<PendingRequest> _requests = Channel.CreateUnbounded<PendingRequest>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false, AllowSynchronousContinuations = false });
    private readonly string? _ipcToken = Environment.GetEnvironmentVariable("GAMINGCAFE_IPC_TOKEN");

    private volatile int _connected;

    public bool IsConnected => _connected == 1;
    public event Action<IpcPush>? PushReceived;
    public event Action<bool>? ConnectionChanged;

    public void Start() => _ = Task.Run(() => ConnectLoopAsync(_cts.Token));

    public async Task<JsonElement?> SendRequestAsync(string method, object? payload, CancellationToken ct = default)
    {
        if (!IsConnected) return null;

        var reply = new TaskCompletionSource<JsonElement?>(TaskCreationOptions.RunContinuationsAsynchronously);
        await _requests.Writer.WriteAsync(new PendingRequest(method, WithIpcToken(payload), reply), ct);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            return await reply.Task.WaitAsync(timeout.Token);
        }
        catch
        {
            reply.TrySetResult(null);
            return null;
        }
    }

    private object? WithIpcToken(object? payload)
    {
        if (string.IsNullOrWhiteSpace(_ipcToken)) return payload;
        if (payload is null) return new { ipc_token = _ipcToken };
        if (payload is JsonElement el && el.ValueKind == JsonValueKind.Object)
        {
            var dict = el.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value.Clone());
            dict["ipc_token"] = _ipcToken;
            return dict;
        }
        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        var map = doc.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value.Clone());
        map["ipc_token"] = _ipcToken;
        return map;
    }

    private async Task ConnectLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            NamedPipeClientStream? pipe = null;
            try
            {
                pipe = new NamedPipeClientStream(".", IpcProtocol.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                await pipe.ConnectAsync(3000, ct);

                using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
                using var writer = new StreamWriter(pipe, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

                SetConnected(true);
                await SessionLoopAsync(reader, writer, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                // agent absent — retry
            }
            finally
            {
                SetConnected(false);
                FailAllPendingRequests();
                pipe?.Dispose();
            }

            try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task SessionLoopAsync(StreamReader reader, StreamWriter writer, CancellationToken ct)
    {
        PendingRequest? inFlight = null;

        while (!ct.IsCancellationRequested)
        {
            if (inFlight is null && _requests.Reader.TryRead(out var next))
            {
                inFlight = next;
                var body = JsonSerializer.Serialize(new { method = inFlight.Method, payload = inFlight.Payload });
                await writer.WriteLineAsync(body.AsMemory(), ct);
            }

            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;

            if (TryParseResponse(line, out var data, out var ok))
            {
                inFlight?.Reply.TrySetResult(data);
                inFlight = null;
                continue;
            }

            if (TryParsePush(line, out var push))
            {
                PushReceived?.Invoke(push);
            }
        }

        inFlight?.Reply.TrySetResult(null);
    }

    private void SetConnected(bool connected)
    {
        _connected = connected ? 1 : 0;
        ConnectionChanged?.Invoke(connected);
    }

    private void FailAllPendingRequests()
    {
        while (_requests.Reader.TryRead(out var pending))
        {
            pending.Reply.TrySetResult(null);
        }
    }

    private static bool TryParseResponse(string line, out JsonElement? data, out bool ok)
    {
        data = null;
        ok = false;
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (!root.TryGetProperty("ok", out var okEl)) return false;

            ok = okEl.GetBoolean();
            if (!ok)
            {
                data = JsonSerializer.SerializeToElement(new
                {
                    ok = false,
                    error = root.TryGetProperty("error", out var err) ? err.GetString() : "Request failed",
                });
                return true;
            }

            data = root.TryGetProperty("data", out var payload)
                ? payload.Clone()
                : JsonSerializer.SerializeToElement(new { });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryParsePush(string line, out IpcPush push)
    {
        push = new IpcPush("", JsonSerializer.SerializeToElement(new { }));
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl)) return false;

            push = new IpcPush(
                typeEl.GetString() ?? "",
                root.TryGetProperty("data", out var d) ? d.Clone() : JsonSerializer.SerializeToElement(new { }));
            return true;
        }
        catch
        {
            return false;
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _requests.Writer.TryComplete();
        FailAllPendingRequests();
        SetConnected(false);
        _cts.Dispose();
    }
}
