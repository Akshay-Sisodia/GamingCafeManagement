using System.Diagnostics;

namespace PcAgent.Core.Windows;

/// <summary>Process/machine control surface (kept tiny for testability).</summary>
public interface IProcessController
{
    void LaunchTracked(string executablePath, string? arguments);
    void KillAllTracked();
    int TrackedRunningCount();
    void LockStation();
    void RestartMachine();
    void ShutdownMachine();
    event Action? TrackedProcessesChanged;
}

/// <summary>
/// Tracks game processes launched by the agent and terminates them on session
/// end. Machine restart/shutdown uses the standard shutdown utility.
/// </summary>
public sealed class ProcessController : IProcessController
{
    private readonly object _gate = new();
    private readonly List<Process> _tracked = new();
    private readonly Action<string> _log;

    public event Action? TrackedProcessesChanged;

    public ProcessController(Action<string>? log = null) => _log = log ?? (_ => { });

    public void LaunchTracked(string executablePath, string? arguments)
    {
        if (!File.Exists(executablePath))
        {
            throw new FileNotFoundException($"Executable not found: {executablePath}");
        }

        var psi = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = arguments ?? string.Empty,
            UseShellExecute = true,
        };
        var process = Process.Start(psi)
            ?? throw new InvalidOperationException($"Failed to start: {executablePath}");
        process.EnableRaisingEvents = true;
        process.Exited += (_, _) => NotifyTrackedChanged();
        lock (_gate)
        {
            _tracked.RemoveAll(p => p.HasExited);
            _tracked.Add(process);
        }
        _log($"launched {executablePath} pid={process.Id}");
        NotifyTrackedChanged();
    }

    public int TrackedRunningCount()
    {
        lock (_gate)
        {
            _tracked.RemoveAll(p => p.HasExited);
            return _tracked.Count;
        }
    }

    public void KillAllTracked()
    {
        List<Process> toKill;
        lock (_gate)
        {
            toKill = _tracked.Where(p => !p.HasExited).ToList();
            _tracked.Clear();
        }

        if (toKill.Count == 0) return;

        _ = Task.Run(() =>
        {
            toKill.ForEach(process =>
            {
                try { process.CloseMainWindow(); } catch { /* ignore */ }
            });

            Thread.Sleep(500);
            toKill.ForEach(process =>
            {
                try
                {
                    if (!process.HasExited && !process.WaitForExit(9500))
                    {
                        process.Kill(entireProcessTree: true);
                    }
                }
                catch (Exception ex)
                {
                    _log($"kill failed: {ex.Message}");
                }
            });
            NotifyTrackedChanged();
        });
    }

    public void LockStation()
    {
        _ = LockWorkStation();
    }

    public void RestartMachine() => RunShutdown("/r /t 5 /c \"PACMAN Gaming Cafe\"");

    public void ShutdownMachine() => RunShutdown("/s /t 5 /c \"PACMAN Gaming Cafe\"");

    private void NotifyTrackedChanged() => TrackedProcessesChanged?.Invoke();

    private void RunShutdown(string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "shutdown",
            Arguments = args,
            UseShellExecute = true,
            CreateNoWindow = true,
        };
        Process.Start(psi);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool LockWorkStation();
}
