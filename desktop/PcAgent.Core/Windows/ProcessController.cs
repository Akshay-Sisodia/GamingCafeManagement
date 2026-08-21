using System.Diagnostics;

namespace PcAgent.Core.Windows;

/// <summary>Process/machine control surface (kept tiny for testability).</summary>
public interface IProcessController
{
    void LaunchTracked(string executablePath, string? arguments);
    void KillAllTracked();
    void LockStation();
    void RestartMachine();
    void ShutdownMachine();
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

    public ProcessController(Action<string>? log = null) => _log = log ?? (_ => { });

    public void LaunchTracked(string executablePath, string? arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = arguments ?? string.Empty,
            UseShellExecute = true,
        };
        var process = Process.Start(psi);
        if (process is null) return;
        lock (_gate)
        {
            _tracked.RemoveAll(p => p.HasExited);
            _tracked.Add(process);
        }
        _log($"launched {executablePath} pid={process.Id}");
    }

    public void KillAllTracked()
    {
        List<Process> toKill;
        lock (_gate)
        {
            toKill = _tracked.Where(p => !p.HasExited).ToList();
            _tracked.Clear();
        }

        foreach (var process in toKill)
        {
            try { process.CloseMainWindow(); } catch { /* ignore */ }
        }

        // Grace period, then hard kill.
        Thread.Sleep(500);
        foreach (var process in toKill)
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
        }
    }

    public void LockStation()
    {
        _ = LockWorkStation();
    }

    public void RestartMachine() => RunShutdown("/r /t 5 /c \"PACMAN Gaming Cafe\"");

    public void ShutdownMachine() => RunShutdown("/s /t 5 /c \"PACMAN Gaming Cafe\"");

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
