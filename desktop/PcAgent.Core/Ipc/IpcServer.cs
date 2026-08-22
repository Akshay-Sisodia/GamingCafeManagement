using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace PcAgent.Core.Ipc;

public sealed record IpcRequest(string Method, JsonElement Payload);

/// <summary>
/// Named-pipe JSON server the Gaming Launcher talks to (pipe "GamingCafeAgent").
/// One connection, one read loop, all writes serialized through a gate.
/// </summary>
public sealed class IpcServer
{
    public const string PipeName = "GamingCafeAgent";

    private readonly Func<IpcRequest, CancellationToken, Task<object?>> _handler;
    private readonly Action<string> _log;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private Func<string, Task>? _writeCurrent;
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
            var server = CreateServerStream();

            try
            {
                await server.WaitForConnectionAsync(ct);
                _log("pipe client accepted");
            }
            catch (OperationCanceledException)
            {
                server.Dispose();
                break;
            }
            catch (Exception ex)
            {
                _log($"IPC accept error: {ex.Message}");
                server.Dispose();
                try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { break; }
                continue;
            }

            try
            {
                using (server)
                using (var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true))
                using (var writer = new StreamWriter(server, Encoding.UTF8, leaveOpen: true) { AutoFlush = true })
                {
                    _writeCurrent = json => writer.WriteLineAsync(json);
                    _boundConn = Interlocked.Increment(ref _connSeq);
                    _log($"pipe writer bound (conn #{_boundConn})");

                    if (ClientConnected is not null)
                    {
                        _ = Task.Run(async () =>
                        {
                            try { await ClientConnected.Invoke(); }
                            catch (Exception ex) { _log($"client-connected hook failed: {ex.Message}"); }
                        });
                    }

                    while (!ct.IsCancellationRequested && server.IsConnected)
                    {
                        var line = await reader.ReadLineAsync(ct);
                        if (line is null) break;

                        object? result;
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
            }
            catch (Exception ex)
            {
                _log($"IPC connection error: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                _writeCurrent = null;
                _boundConn = -1;
                _log("launcher IPC disconnected; waiting for reconnect");
            }
        }
    }

    private async Task WriteAsync(string json)
    {
        var write = _writeCurrent;
        if (write is null) return;

        await _writeGate.WaitAsync();
        try
        {
            await write(json);
        }
        catch (Exception ex)
        {
            _log($"IPC write failed (conn #{_boundConn}): {ex.Message}");
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>Pushes an event to the connected launcher, if any.</summary>
    public Task PushAsync(string type, object? data)
    {
        try
        {
            var message = JsonSerializer.Serialize(new { type, data });
            return WriteAsync(message);
        }
        catch (Exception ex)
        {
            _log($"push {type} failed: {ex.Message}");
            return Task.CompletedTask;
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _writeGate.Dispose();
        _cts.Dispose();
    }

  private static NamedPipeServerStream CreateServerStream()
    {
        if (!OperatingSystem.IsWindows())
        {
            return new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);
        }

        // Service (LocalSystem) must accept connections from the kiosk user session.
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.WorldSid, null),
            PipeAccessRights.ReadWrite,
            AccessControlType.Allow));
        return NamedPipeServerStreamAcl.Create(
            PipeName,
            PipeDirection.InOut,
            maxNumberOfServerInstances: 1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous,
            inBufferSize: 4096,
            outBufferSize: 4096,
            security);
    }
}
