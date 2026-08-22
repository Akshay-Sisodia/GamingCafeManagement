using System.Text.Json;
using System.Text.Json.Serialization;
using PcAgent.Core.Storage;

namespace PcAgent.Core.Games;

public sealed record LocalGame(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("executable_path")] string ExecutablePath,
    [property: JsonPropertyName("launch_args")] string LaunchArgs = "",
    [property: JsonPropertyName("icon_url")] string? IconUrl = null,
    [property: JsonPropertyName("icon_path")] string? IconPath = null,
    [property: JsonPropertyName("source_shortcut")] string? SourceShortcut = null,
    [property: JsonPropertyName("category")] string? Category = null);

public sealed record DiscoveredGame(
    string Name,
    string ExecutablePath,
    string LaunchArgs,
    string SourcePath,
    string Category);

/// <summary>Per-PC game library — games.local.json + SQLite cache.</summary>
public sealed class LocalGameStore
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        WriteIndented = true,
    };

    private readonly AgentDatabase _db;
    private readonly string _configPath;
    private readonly string _blocklistPath;
    private readonly string _iconsDir;
    private HashSet<string>? _blockedPaths;
    private readonly object _gate = new();
    private List<LocalGame>? _cache;

    public LocalGameStore(AgentDatabase db, string dataDirectory)
    {
        _db = db;
        _configPath = Path.Combine(dataDirectory, "games.local.json");
        _blocklistPath = Path.Combine(dataDirectory, "games.blocklist.json");
        _iconsDir = Path.Combine(dataDirectory, "icons");
    }

    public string ConfigPath => _configPath;
    public string IconsDirectory => _iconsDir;

    public IReadOnlyList<LocalGame> Load()
    {
        lock (_gate)
        {
            EnsureConfigFile();
            _cache = ReadConfigFile();
            return _cache;
        }
    }

    public void Save(IReadOnlyList<LocalGame> games)
    {
        lock (_gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_configPath)!);
            File.WriteAllText(_configPath, JsonSerializer.Serialize(games, JsonOpts));
            WriteCache(games);
            _cache = games.ToList();
        }
    }

    public bool HasExecutable(string executablePath) =>
        Load().Any(g => PathsEqual(g.ExecutablePath, executablePath));

    public bool IsBlocked(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        return BlockedPaths.Contains(NormalizePath(path));
    }

    public void BlockGame(LocalGame game)
    {
        BlockPath(game.ExecutablePath);
        BlockPath(game.SourceShortcut);
    }

    public void UnblockDiscovery(string executablePath, string? sourcePath = null)
    {
        UnblockPath(executablePath);
        UnblockPath(sourcePath);
    }

    private void BlockPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        var set = BlockedPaths;
        if (!set.Add(NormalizePath(path))) return;
        SaveBlocklist(set);
    }

    private void UnblockPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        var set = BlockedPaths;
        if (!set.Remove(NormalizePath(path))) return;
        SaveBlocklist(set);
    }

    private HashSet<string> BlockedPaths => _blockedPaths ??= ReadBlocklist();

    private HashSet<string> ReadBlocklist()
    {
        EnsureBlocklistFile();
        try
        {
            var json = File.ReadAllText(_blocklistPath);
            return JsonSerializer.Deserialize<List<string>>(json, JsonOpts)?
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(NormalizePath)
                .ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private void SaveBlocklist(HashSet<string> paths)
    {
        _blockedPaths = paths;
        Directory.CreateDirectory(Path.GetDirectoryName(_blocklistPath)!);
        File.WriteAllText(_blocklistPath, JsonSerializer.Serialize(paths.OrderBy(p => p, StringComparer.OrdinalIgnoreCase), JsonOpts));
    }

    private void EnsureBlocklistFile()
    {
        if (File.Exists(_blocklistPath)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(_blocklistPath)!);
        File.WriteAllText(_blocklistPath, "[]");
    }

    public LocalGame Add(LocalGame game)
    {
        var games = Load().Where(g => g.Id != game.Id).ToList();
        games.Add(game);
        Save(games);
        return game;
    }

    public bool Remove(string gameId)
    {
        var games = Load();
        var next = games.Where(g => g.Id != gameId).ToList();
        if (next.Count == games.Count) return false;
        Save(next);
        return true;
    }

    public LocalGame? Update(LocalGame game)
    {
        var games = Load().ToList();
        var index = games.FindIndex(g => g.Id == game.Id);
        if (index < 0) return null;
        games[index] = game;
        Save(games);
        return game;
    }

    private void EnsureConfigFile()
    {
        if (File.Exists(_configPath)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(_configPath)!);
        File.WriteAllText(_configPath, "[]");
    }

    private List<LocalGame> ReadConfigFile()
    {
        try
        {
            var json = File.ReadAllText(_configPath);
            return JsonSerializer.Deserialize<List<LocalGame>>(json, JsonOpts)?
                .Where(g => !string.IsNullOrWhiteSpace(g.Id) && !string.IsNullOrWhiteSpace(g.Name))
                .ToList() ?? [];
        }
        catch
        {
            return [];
        }
    }

    private List<LocalGame> ReadCache()
    {
        var rows = _db.Query("SELECT json FROM games_cache ORDER BY game_id");
        return rows
            .Select(row => row["json"] as string)
            .Where(json => json is not null)
            .Select(json =>
            {
                try { return JsonSerializer.Deserialize<LocalGame>(json!, JsonOpts); }
                catch { return null; }
            })
            .Where(game => game is not null)
            .Cast<LocalGame>()
            .ToList();
    }

    private void WriteCache(IReadOnlyList<LocalGame> games)
    {
        _db.ExecuteNonQuery("DELETE FROM games_cache");
        games.ToList().ForEach(game =>
        {
            _db.ExecuteNonQuery(
                "INSERT INTO games_cache(game_id, json, manifest_version) VALUES($id, $json, 'local')",
                ("$id", game.Id),
                ("$json", JsonSerializer.Serialize(game, JsonOpts)));
        });
    }

    public static bool PathsEqual(string a, string b) =>
        string.Equals(NormalizePath(a), NormalizePath(b), StringComparison.OrdinalIgnoreCase);

    private static string NormalizePath(string path)
    {
        try { return Path.GetFullPath(path); }
        catch { return path.Trim(); }
    }
}
