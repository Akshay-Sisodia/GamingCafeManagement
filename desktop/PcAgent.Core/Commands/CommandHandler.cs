using System.Text.Json;
using PcAgent.Core.Api;
using PcAgent.Core.Sessions;
using PcAgent.Core.Windows;

namespace PcAgent.Core.Commands;

/// <summary>
/// Applies cloud commands delivered over SSE and acknowledges them (docs/03 §4).
/// </summary>
public sealed class CommandHandler
{
    private readonly SessionEngine _sessions;
    private readonly IProcessController _processes;
    private readonly Func<Task> _refreshConfig;
    private readonly Action<string> _log;
    private readonly Func<string, Task> _ackApplied;
    private readonly Func<string, string, Task> _ackFailed;

    public CommandHandler(
        SessionEngine sessions,
        IProcessController processes,
        Func<Task> refreshConfig,
        Func<string, Task> ackApplied,
        Func<string, string, Task> ackFailed,
        Action<string>? log = null)
    {
        _sessions = sessions;
        _processes = processes;
        _refreshConfig = refreshConfig;
        _ackApplied = ackApplied;
        _ackFailed = ackFailed ?? ((id, code) => Task.CompletedTask);
        _log = log ?? (_ => { });
    }

    public async Task HandleAsync(JsonElement command, CancellationToken ct)
    {
        var commandId = command.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        var type = command.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null;
        if (commandId is null || type is null)
        {
            _log("command event missing id/type");
            return;
        }

        try
        {
            await ApplyAsync(type, command);
            await _ackApplied(commandId);
            _log($"command {type} applied ({commandId})");
        }
        catch (Exception ex)
        {
            _log($"command {type} failed: {ex.Message}");
            try { await _ackFailed(commandId, ex.Message.Length > 60 ? "FAILED" : ex.Message); }
            catch { /* best effort */ }
        }
    }

    private Task ApplyAsync(string type, JsonElement command)
    {
        switch (type)
        {
            case "extend_session":
                {
                    var minutes = command.TryGetProperty("payload", out var p) &&
                                  p.TryGetProperty("minutes", out var m)
                        ? m.GetInt32()
                        : throw new InvalidOperationException("missing minutes");
                    if (_sessions.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
                    {
                        _sessions.Extend(minutes, suppressOutboxEcho: true);
                    }
                    else
                    {
                        throw new InvalidOperationException("NO_ACTIVE_SESSION");
                    }
                    return Task.CompletedTask;
                }

            case "end_session":
                _sessions.End("admin_command", suppressOutboxEcho: true);
                _processes.KillAllTracked();
                return Task.CompletedTask;

            case "lock":
                _processes.LockStation();
                return Task.CompletedTask;

            case "unlock":
                return Task.CompletedTask; // kiosk unlock handled by launcher policy

            case "launch_game":
                {
                    var payload = command.TryGetProperty("payload", out var p) ? p : default;
                    var exe = payload.ValueKind == JsonValueKind.Object &&
                              payload.TryGetProperty("executable_path", out var e)
                        ? e.GetString()
                        : null;
                    var args = payload.ValueKind == JsonValueKind.Object &&
                               payload.TryGetProperty("launch_args", out var a)
                        ? a.GetString()
                        : null;
                    if (exe is null) throw new InvalidOperationException("missing executable_path");
                    _processes.LaunchTracked(exe, args);
                    return Task.CompletedTask;
                }

            case "restart":
                _processes.RestartMachine();
                return Task.CompletedTask;

            case "shutdown":
                _processes.ShutdownMachine();
                return Task.CompletedTask;

            case "refresh_config":
                return _refreshConfig();

            case "request_health":
                return Task.CompletedTask; // next health loop iteration reports

            default:
                throw new InvalidOperationException($"UNKNOWN_COMMAND:{type}");
        }
    }
}
