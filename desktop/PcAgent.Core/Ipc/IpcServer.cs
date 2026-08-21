using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace PcAgent.Core.Ipc;

public sealed record IpcRequest(string Method, JsonElement Payload);

/// <summary>
/// Named-pipe JSON server the Gaming Launcher talks to (pipe "GamingCafeAgent").
/// Newline-delimited JSON: {"method":"...","payload":{...}} → {"ok":true,"data":{...}}.
/// The launcher is unprivileged — every privileged action arrives here.
/// </summary>
public sealed class IpcServer
{
    public const string PipeName = "GamingCafeAgent";

    private readonly Func<IpcRequest, CancellationToken, Task<object?>> _handler;
    private readonly Action<string> _log;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1); // timer pushes vs responses
    private Func<string, Task>? _writeCurrent;             // bound per connection
    private int _connSeq;
    private int _boundConn = -1;

    /// <summary>Raised when a launcher connects — push initial state immediately.</summary>
    public event Func<Task>? ClientConnected;

    public IpcServer(Func<IpcRequest, CancellationToken, Task<object?>> handler, Action<string>? log = null)
    {
        _handler = handler;
        _log = log ?? (_ => { });
    }

    public void Start()
    {
        _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var server = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);

            try
            {
                await server.WaitForConnectionAsync(ct);
            }
            catch (OperationCanceledException) { server.Dispose(); break; }
            catch (Exception ex)
            {
                _log($"IPC accept error: {ex.Message}");
                server.Dispose();
                try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { break; }
                continue;
            }

            var conn = ++_connSeq;
            _log($"pipe handshake complete (conn #{conn})");

            using (server)
            using (var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true))
            using (var writer = new StreamWriter(server, Encoding.UTF8, leaveOpen: true) { AutoFlush = true })
            {
                // Bind the write target for THIS connection only; cleared on exit
                // so a stale handle can never be used after a disconnect.
                _writeCurrent = json => writer.WriteLineAsync(json);
                _boundConn = conn;
                _log($"pipe writer bound (conn #{_boundConn})");

                try
                {
                    if (ClientConnected is not null)
                    {
                        try { await ClientConnected.Invoke(); }
                        catch (Exception ex) { _log($"client-connected hook failed (conn #{conn}): {ex.Message}"); }
                    }

                    while (!ct.IsCancellationRequested && server.IsConnected)
                    {
                        var line = await reader.ReadLineAsync(ct);
                        if (line is null)
                        {
                            _log($"read loop exit (conn #{conn}): client EOF");
                            break;
                        }

                        object? result = null;
                        try
                        {
                            using var doc = JsonDocument.Parse(line);
                            var method = doc.RootElement.TryGetProperty("method", out var m) ? m.GetString() : null;
                            var payload = doc.RootElement.TryGetProperty("payload", out var p)
                                ? p.Clone()
                                : JsonSerializer.SerializeToElement(new { });
                            if (method is null) throw new ArgumentException("missing method");
                            result = await _handler(new IpcRequest(method, payload), ct);
                        }
                        catch (Exception ex)
                        {
                            await WriteAsync(JsonSerializer.Serialize(new { ok = false, error = ex.Message }));
                            continue;
                        }
                        await WriteAsync(JsonSerializer.Serialize(new { ok = true, data = result }));
                    }
                }
                finally
                {
                    _writeCurrent = null;
                    _log($"pipe writer unbound (conn #{conn})");
                }
            }
            _log($"launcher IPC disconnected (conn #{conn}); waiting for reconnect");
        }
    }

    private async Task WriteAsync(string json)
    {
        var write = _writeCurrent;
        if (write is null)
        {
            _log($"write skipped (no bound writer, last conn #{_boundConn}): {json[..Math.Min(48, json.Length)]}");
            return;
        }
        // Timer pushes (main loop) and request responses (read loop) share the
        // pipe — without this gate their frames interleave and corrupt JSON.
        await _writeGate.WaitAsync();
        try
        {
            await write(json);
        }
        catch (Exception ex)
        {
            _log($"write failed (conn #{_boundConn}): {ex.Message}");
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>Pushes an event to the connected launcher, if any.</summary>
    public async Task PushAsync(string type, object? data)
    {
        try
        {
            var message = JsonSerializer.Serialize(new { type, data });
            await WriteAsync(message);
        }
        catch (Exception ex)
        {
            _log($"push {type} failed: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}
