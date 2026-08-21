using System.IO;
using System.Text;

namespace GamingLauncher.Services;

/// <summary>Append-only file logger (%LOCALAPPDATA%\GamingCafe\launcher.log).</summary>
public static class SimpleFileLogger
{
    private static readonly object Gate = new();
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "GamingCafe", "launcher.log");

    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message) => Write("ERROR", message);

    private static void Write(string level, string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(LogPath,
                    $"{DateTimeOffset.Now:O} [{level}] {message}{Environment.NewLine}", Encoding.UTF8);
            }
        }
        catch
        {
            // logging must never crash the launcher
        }
    }
}
