using System.Diagnostics;

namespace PcAgent.Core.Launcher;

/// <summary>
/// Starts the Gaming Launcher and restarts it if it crashes (docs/04 §1).
/// Backoff: max 5 restarts/min, then hold 60s.
/// </summary>
public sealed class LauncherSupervisor : IDisposable
{
    private readonly string _launcherPath;
    private readonly Action<string> _log;
    private readonly CancellationTokenSource _cts = new();
    private readonly Queue<DateTimeOffset> _recentStarts = new();
    private Process? _current;

    public LauncherSupervisor(string launcherPath, Action<string>? log = null)
    {
        _launcherPath = launcherPath;
        _log = log ?? (_ => { });
    }

    public void Start()
    {
        _ = Task.Run(() => SuperviseAsync(_cts.Token));
    }

    private async Task SuperviseAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (RateLimited())
                {
                    await DelayAsync(TimeSpan.FromSeconds(60), ct);
                    continue;
                }

                _current = Process.Start(new ProcessStartInfo
                {
                    FileName = _launcherPath,
                    UseShellExecute = true,
                });
                if (_current is null)
                {
                    _log("launcher failed to start");
                    await DelayAsync(TimeSpan.FromSeconds(5), ct);
                    continue;
                }

                NoteStart();
                _log($"launcher started pid={_current.Id}");
                try
                {
                    await _current.WaitForExitAsync(ct);
                    _log($"launcher exited code={_current.ExitCode}; restarting");
                }
                catch (OperationCanceledException) { break; }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _log($"launcher supervision error: {ex.Message}");
                await DelayAsync(TimeSpan.FromSeconds(5), ct);
            }
        }
    }

    private bool RateLimited()
    {
        lock (_recentStarts)
        {
            var cutoff = DateTimeOffset.UtcNow.AddMinutes(-1);
            while (_recentStarts.Count > 0 && _recentStarts.Peek() < cutoff)
            {
                _recentStarts.Dequeue();
            }
            return _recentStarts.Count >= 5;
        }
    }

    private void NoteStart()
    {
        lock (_recentStarts)
        {
            _recentStarts.Enqueue(DateTimeOffset.UtcNow);
        }
    }

    private static async Task DelayAsync(TimeSpan delay, CancellationToken ct)
    {
        try { await Task.Delay(delay, ct); }
        catch (OperationCanceledException) { }
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _current?.Kill(); } catch { /* ignore */ }
        _cts.Dispose();
    }
}
