using System.Diagnostics;

namespace PcAgent.Core.Health;

public sealed record HealthSample(
    double CpuPct,
    double RamPct,
    double DiskPct,
    long DiskFreeBytes,
    long UptimeSeconds);

/// <summary>
/// Lightweight health sampling using GetSystemTimes + GlobalMemoryStatusEx —
/// no WMI, no perf counters, near-zero cost during gameplay (docs/04 §2).
/// </summary>
public sealed class HealthReporter
{
    private ulong _lastIdle;
    private ulong _lastKernel; // kernel time includes idle
    private ulong _lastUser;
    private readonly DateTime _bootMarker = DateTime.UtcNow;

    public HealthReporter()
    {
        _ = GetSystemTimes(out _lastIdle, out _lastKernel, out _lastUser);
    }

    /// <summary>CPU% since the previous call (call at a steady cadence).</summary>
    public HealthSample Sample()
    {
        var cpuPct = 0.0;
        if (GetSystemTimes(out var idle, out var kernel, out var user))
        {
            var idleDelta = idle - _lastIdle;
            var totalDelta = (kernel - _lastKernel) + (user - _lastUser);
            if (totalDelta > 0)
            {
                cpuPct = 100.0 * (totalDelta - idleDelta) / totalDelta;
            }
            _lastIdle = idle;
            _lastKernel = kernel;
            _lastUser = user;
        }

        var mem = new MEMORYSTATUSEX { dwLength = (uint)System.Runtime.InteropServices.Marshal.SizeOf<MEMORYSTATUSEX>() };
        var ramPct = GlobalMemoryStatusEx(ref mem)
            ? 100.0 * (mem.ullTotalPhys - mem.ullAvailPhys) / Math.Max(mem.ullTotalPhys, 1)
            : 0.0;

        var systemRoot = Path.GetPathRoot(Environment.SystemDirectory);
        var systemDrive = DriveInfo.GetDrives().First(d =>
            d.DriveType == DriveType.Fixed &&
            string.Equals(d.RootDirectory.FullName, systemRoot, StringComparison.OrdinalIgnoreCase));
        var diskPct = systemDrive.TotalSize > 0
            ? 100.0 * (systemDrive.TotalSize - systemDrive.AvailableFreeSpace) / systemDrive.TotalSize
            : 0.0;

        return new HealthSample(
            Math.Round(cpuPct, 1),
            Math.Round(ramPct, 1),
            Math.Round(diskPct, 1),
            systemDrive.AvailableFreeSpace,
            Environment.TickCount64 / 1000);
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(
        out ulong lpIdleTime,
        out ulong lpKernelTime,
        out ulong lpUserTime);
}
