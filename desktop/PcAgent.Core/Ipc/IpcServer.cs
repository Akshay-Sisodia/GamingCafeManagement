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
    private StreamWriter? _currentWriter;

    /// <summary>Raised when a launcher connects — push initial state immediately.</summary>
    public event Func<Task>? ClientConnected;

    /// <summary>Raised for pushes the launcher should receive (timer ticks etc.).</summary>
    public event Func<string, JsonElement?, Task>? PushRequested;

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
            try
            {
                var server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await server.WaitForConnectionAsync(ct);
                _log("launcher IPC connected");
                if (ClientConnected is not null)
                {
                    try { await ClientConnected.Invoke(); } catch (Exception ex) { _log($"client-connected hook failed: {ex.Message}"); }
                }

                using (server)
                using (var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true))
                using (_currentWriter = new StreamWriter(server, Encoding.UTF8, leaveOpen: true) { AutoFlush = true })
                {
                    while (!ct.IsCancellationRequested && server.IsConnected)
                    {
                        var line = await reader.ReadLineAsync(ct);
                        if (line is null) break;

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
                _log("launcher IPC disconnected; waiting for reconnect");
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _log($"IPC accept error: {ex.Message}");
                try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task WriteAsync(string json)
    {
        var writer = _currentWriter;
        if (writer is null) return;
        // Timer pushes (main loop) and request responses (IPC loop) share the
        // pipe — without this gate their frames interleave and corrupt JSON.
        await _writeGate.WaitAsync();
        try
        {
            await writer.WriteLineAsync(json);
        }
        catch
        {
            // launcher not connected — fine
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
        catch
        {
            // launcher not connected — fine
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}
