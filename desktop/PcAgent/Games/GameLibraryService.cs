using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using PcAgent.Core.Games;
using PcAgent.Core.Storage;

namespace PcAgent.Games;

[SupportedOSPlatform("windows")]
public sealed class GameLibraryService
{
    private static readonly string[] SkipNameTokens =
        ["uninstall", "remove", "setup", "install", "redist", "support", "website", "readme", "manual", "update",
         "launcher", "helper", "crash", "report", "eac", "battleye", "directx", "vcredist", "prerequisite"];

    private static readonly string[] SteamSkipFolders =
        ["steamworks shared", "steam linux runtime", "proton", "spacewar", "steam controller"];

    private static readonly string[] EpicSkipFolders = ["launcher"];

    private static readonly string[] GamePathMarkers =
    [
        @"\steamapps\common\",
        @"\epic games\",
        @"\riot games\",
        @"\gog games\",
        @"\xboxgames\",
        @"\ea games\",
        @"\ubisoft game launcher\games\",
        @"\battle.net\",
        @"\games\",
        @"\bethesda.net launcher\",
    ];

    private static readonly string[] NonGamePathMarkers =
    [
        @"\windows\",
        @"\program files\microsoft\",
        @"\program files (x86)\microsoft\",
        @"\program files\google\",
        @"\program files (x86)\google\",
        @"\program files\mozilla firefox\",
        @"\program files\jetbrains\",
        @"\program files\adobe\",
        @"\program files\dotnet\",
        @"\program files\nodejs\",
        @"\program files\cursor\",
        @"\appdata\local\programs\microsoft\",
        @"\appdata\local\discord\",
        @"\appdata\local\spotify\",
        @"\epic games\launcher\",
    ];

    private static readonly string[] NonGameExeNames =
    [
        "chrome", "msedge", "firefox", "code", "devenv", "discord", "spotify", "slack", "teams",
        "notepad", "wordpad", "mspaint", "calc", "explorer", "cmd", "powershell", "wt",
        "vlc", "zoom", "obs64", "obs32", "steam", "epicgameslauncher", "battle.net", "origin",
    ];

    private readonly LocalGameStore _store;
    private readonly Action<string> _log;

    public GameLibraryService(AgentDatabase db, string dataDirectory, Action<string>? log = null)
    {
        _store = new LocalGameStore(db, dataDirectory);
        _log = log ?? (_ => { });
    }

    public LocalGameStore Store => _store;

    public IReadOnlyList<LocalGame> Load() => _store.Load();

    public IReadOnlyList<DiscoveredGame> ScanInstalled()
    {
        var found = new Dictionary<string, DiscoveredGame>(StringComparer.OrdinalIgnoreCase);
        ScanSteam().ToList().ForEach(d => TryAddDiscovery(found, d));
        ScanEpic().ToList().ForEach(d => TryAddDiscovery(found, d));
        ScanRiot().ToList().ForEach(d => TryAddDiscovery(found, d));
        return found.Values.OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Removes auto-imported junk (Start Menu apps etc.) but keeps launcher installs and manual adds.</summary>
    public int PruneNonGames()
    {
        var removed = 0;
        var kept = _store.Load().Where(game =>
        {
            if (!File.Exists(game.ExecutablePath)) { removed++; return false; }
            if (IsLikelyGame(game.ExecutablePath, game.Category)) return true;
            if (IsManualEntry(game)) return true;
            removed++;
            return false;
        }).ToList();

        if (removed > 0)
        {
            _store.Save(kept);
            _log($"library: pruned {removed} non-game entries");
        }
        return removed;
    }

    private static bool IsManualEntry(LocalGame game) =>
        string.Equals(game.Category, "Manual", StringComparison.OrdinalIgnoreCase);

    private static bool IsLikelyGame(string executablePath, string? category) =>
        category is "Steam" or "Epic" or "Riot" || IsLikelyGamePath(executablePath);

    private static bool IsLikelyGamePath(string executablePath)
    {
        var lower = Path.GetFullPath(executablePath).Replace('/', '\\');
        if (NonGamePathMarkers.Any(marker => lower.Contains(marker, StringComparison.OrdinalIgnoreCase)))
            return false;

        var exeName = Path.GetFileNameWithoutExtension(lower);
        if (NonGameExeNames.Any(name => exeName.Equals(name, StringComparison.OrdinalIgnoreCase)))
            return false;

        return GamePathMarkers.Any(marker => lower.Contains(marker, StringComparison.OrdinalIgnoreCase));
    }

    public int ImportDiscovered(bool onlyNew = true)
    {
        var added = 0;
        ScanInstalled().ToList().ForEach(d =>
        {
            if (onlyNew && _store.HasExecutable(d.ExecutablePath)) return;
            if (_store.IsBlocked(d.ExecutablePath) || _store.IsBlocked(d.SourcePath)) return;
            if (!File.Exists(d.ExecutablePath)) return;
            AddFromDiscovery(d);
            added++;
        });
        return added;
    }

    public LocalGame AddFromShortcut(string shortcutOrExePath, string? nameOverride = null)
    {
        var resolved = ResolveShortcutRaw(shortcutOrExePath)
            ?? throw new FileNotFoundException($"Could not resolve shortcut: {shortcutOrExePath}");
        if (!File.Exists(resolved.ExecutablePath))
            throw new FileNotFoundException($"Executable not found: {resolved.ExecutablePath}");

        var discovery = resolved with
        {
            Name = string.IsNullOrWhiteSpace(nameOverride) ? resolved.Name : nameOverride.Trim(),
            Category = "Manual",
        };
        return AddFromDiscovery(discovery);
    }

    public bool Remove(string gameId)
    {
        var game = _store.Load().FirstOrDefault(g => g.Id == gameId);
        if (game is null) return false;
        _store.BlockGame(game);
        return _store.Remove(gameId);
    }

    public LocalGame SetThumbnail(string gameId, string sourceImagePath)
    {
        var game = _store.Load().FirstOrDefault(g => g.Id == gameId)
            ?? throw new KeyNotFoundException($"unknown game: {gameId}");
        if (!File.Exists(sourceImagePath))
            throw new FileNotFoundException("image not found", sourceImagePath);

        Directory.CreateDirectory(_store.IconsDirectory);
        var outPath = Path.Combine(_store.IconsDirectory, $"{gameId}.png");
        var ext = Path.GetExtension(sourceImagePath).ToLowerInvariant();

        if (ext == ".png")
        {
            File.Copy(sourceImagePath, outPath, overwrite: true);
        }
        else if (ext is ".jpg" or ".jpeg" or ".bmp" or ".gif")
        {
            using var img = Image.FromFile(sourceImagePath);
            img.Save(outPath, ImageFormat.Png);
        }
        else
        {
            throw new InvalidOperationException($"use PNG, JPG, BMP, or GIF (not {ext})");
        }

        var updated = _store.Update(game with { IconPath = outPath, IconUrl = null })
            ?? throw new InvalidOperationException($"failed to update {gameId}");
        _log($"library: thumbnail set for {updated.Name}");
        return updated;
    }

    public LocalGame SetLaunchPath(string gameId, string shortcutOrExePath)
    {
        var game = _store.Load().FirstOrDefault(g => g.Id == gameId)
            ?? throw new KeyNotFoundException($"unknown game: {gameId}");
        var resolved = ResolveShortcutRaw(shortcutOrExePath)
            ?? throw new FileNotFoundException($"Could not resolve: {shortcutOrExePath}");
        if (!File.Exists(resolved.ExecutablePath))
            throw new FileNotFoundException($"Executable not found: {resolved.ExecutablePath}");

        var updated = _store.Update(game with
        {
            ExecutablePath = resolved.ExecutablePath,
            LaunchArgs = resolved.LaunchArgs,
            SourceShortcut = resolved.SourcePath,
            Category = "Manual",
        }) ?? throw new InvalidOperationException($"failed to update {gameId}");

        _log($"library: launch path set for {updated.Name}");
        return updated;
    }

    private LocalGame AddFromDiscovery(DiscoveredGame discovery)
    {
        _store.UnblockDiscovery(discovery.ExecutablePath, discovery.SourcePath);
        var existing = _store.Load().FirstOrDefault(g => LocalGameStore.PathsEqual(g.ExecutablePath, discovery.ExecutablePath));
        if (existing is not null) return existing;

        var id = MakeUniqueId(discovery.Name);
        var iconPath = ExtractIcon(discovery, id);
        var game = new LocalGame(
            id,
            discovery.Name,
            discovery.ExecutablePath,
            discovery.LaunchArgs,
            IconPath: iconPath,
            SourceShortcut: discovery.SourcePath,
            Category: discovery.Category);
        _store.Add(game);
        _log($"library: added {game.Name}");
        return game;
    }

    private string? ExtractIcon(DiscoveredGame discovery, string gameId)
    {
        try
        {
            Directory.CreateDirectory(_store.IconsDirectory);
            var iconSource = discovery.SourcePath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)
                ? discovery.ExecutablePath
                : discovery.SourcePath;
            using var icon = Icon.ExtractAssociatedIcon(iconSource);
            if (icon is null) return null;

            var outPath = Path.Combine(_store.IconsDirectory, $"{gameId}.png");
            using var bmp = icon.ToBitmap();
            bmp.Save(outPath, ImageFormat.Png);
            return outPath;
        }
        catch (Exception ex)
        {
            _log($"library: icon extract failed for {discovery.Name}: {ex.Message}");
            return null;
        }
    }

    private IEnumerable<DiscoveredGame> ScanSteam()
    {
        var steamRoot = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", null) as string
            ?? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Valve\Steam", "InstallPath", null) as string;
        if (string.IsNullOrWhiteSpace(steamRoot)) return [];

        var common = Path.Combine(steamRoot, "steamapps", "common");
        if (!Directory.Exists(common)) return [];

        return Directory.EnumerateDirectories(common)
            .Where(dir => !SteamSkipFolders.Contains(Path.GetFileName(dir), StringComparer.OrdinalIgnoreCase))
            .Select(dir => new { Dir = dir, Name = Path.GetFileName(dir) })
            .Select(x => new { x.Name, Exe = PickBestExe(x.Dir, x.Name), x.Dir })
            .Where(x => x.Exe is not null && !ShouldSkip(x.Exe!, x.Name))
            .Select(x => new DiscoveredGame(x.Name, x.Exe!, "", x.Dir, "Steam"));
    }

    private IEnumerable<DiscoveredGame> ScanEpic()
    {
        return EpicInstallRoots()
            .SelectMany(root => Directory.EnumerateDirectories(root)
                .Where(dir => !EpicSkipFolders.Contains(Path.GetFileName(dir), StringComparer.OrdinalIgnoreCase))
                .Select(dir => new { Dir = dir, Name = Path.GetFileName(dir) })
                .Select(x => new { x.Name, Exe = PickBestExe(x.Dir, x.Name), x.Dir })
                .Where(x => x.Exe is not null && !ShouldSkip(x.Exe!, x.Name))
                .Select(x => new DiscoveredGame(x.Name, x.Exe!, "", x.Dir, "Epic")));
    }

    private static IEnumerable<string> EpicInstallRoots()
    {
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            @"C:\Program Files\Epic Games",
            @"C:\Program Files (x86)\Epic Games",
        };
        var manifestDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Epic", "EpicGamesLauncher", "Data", "Manifests");
        if (Directory.Exists(manifestDir))
        {
            Directory.EnumerateFiles(manifestDir, "*.item").ToList().ForEach(file =>
            {
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(file));
                    if (doc.RootElement.TryGetProperty("InstallLocation", out var loc) &&
                        loc.GetString() is { Length: > 0 } installPath)
                    {
                        var parent = Path.GetDirectoryName(installPath);
                        if (parent is not null) roots.Add(parent);
                    }
                }
                catch { /* skip bad manifest */ }
            });
        }
        return roots.Where(Directory.Exists);
    }

    private IEnumerable<DiscoveredGame> ScanRiot()
    {
        var riotRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "..", "Riot Games");
        riotRoot = Path.GetFullPath(riotRoot);
        var altRoot = @"C:\Riot Games";
        return new[] { riotRoot, altRoot }
            .Where(Directory.Exists)
            .SelectMany(root => Directory.EnumerateDirectories(root)
                .Select(dir => new { Dir = dir, Name = Path.GetFileName(dir) })
                .Select(x => new { x.Name, Exe = PickBestExe(x.Dir, x.Name), x.Dir })
                .Where(x => x.Exe is not null && !ShouldSkip(x.Exe!, x.Name))
                .Select(x => new DiscoveredGame(x.Name, x.Exe!, "", x.Dir, "Riot")));
    }

    private static string? PickBestExe(string gameDir, string folderName)
    {
        var exes = Directory.EnumerateFiles(gameDir, "*.exe", SearchOption.AllDirectories)
            .Where(path => !ShouldSkip(path, Path.GetFileName(path)))
            .ToList();
        if (exes.Count == 0) return null;

        return exes
            .OrderByDescending(path => ScoreExe(path, folderName))
            .First();
    }

    private static int ScoreExe(string path, string folderName)
    {
        var file = Path.GetFileNameWithoutExtension(path);
        var score = 0;
        if (file.Equals(folderName, StringComparison.OrdinalIgnoreCase)) score += 100;
        if (file.Contains("Shipping", StringComparison.OrdinalIgnoreCase)) score += 40;
        if (file.Contains("Client", StringComparison.OrdinalIgnoreCase)) score += 30;
        if (file.Contains("Game", StringComparison.OrdinalIgnoreCase)) score += 20;
        if (path.Contains("Binaries", StringComparison.OrdinalIgnoreCase)) score += 10;
        return score;
    }

    private static bool ShouldSkip(string path, string label)
    {
        var lower = $"{path} {label}".ToLowerInvariant();
        return SkipNameTokens.Any(token => lower.Contains(token, StringComparison.Ordinal))
            || lower.Contains("\\windows\\", StringComparison.Ordinal)
            || lower.Contains("\\temp\\", StringComparison.Ordinal);
    }

    private static DiscoveredGame? ResolveShortcutRaw(string path)
    {
        if (!File.Exists(path)) return null;

        if (path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            return new DiscoveredGame(
                Path.GetFileNameWithoutExtension(path),
                Path.GetFullPath(path),
                "",
                path,
                "Manual");
        }

        if (!path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)) return null;

        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType is null) return null;

        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic shortcut = shell.CreateShortcut(path);
        var target = (string)shortcut.TargetPath;
        var args = (string)shortcut.Arguments ?? "";
        if (string.IsNullOrWhiteSpace(target) || !target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            return null;

        var name = Path.GetFileNameWithoutExtension(path);
        if (ShouldSkip(target, name)) return null;

        return new DiscoveredGame(name, Path.GetFullPath(target), args, path, "Manual");
    }

    private static void TryAddDiscovery(Dictionary<string, DiscoveredGame> found, DiscoveredGame? item)
    {
        if (item is null || !File.Exists(item.ExecutablePath)) return;
        found.TryAdd(item.ExecutablePath.ToLowerInvariant(), item);
    }

    private string MakeUniqueId(string name)
    {
        var slug = Regex.Replace(name.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        if (string.IsNullOrWhiteSpace(slug)) slug = "game";
        slug = slug.Length > 28 ? slug[..28] : slug;

        var ids = _store.Load().Select(g => g.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!ids.Contains(slug)) return slug;

        return Enumerable.Range(2, 99)
            .Select(n => $"{slug}-{n}")
            .First(candidate => !ids.Contains(candidate));
    }
}
