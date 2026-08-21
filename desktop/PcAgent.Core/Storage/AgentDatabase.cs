using Microsoft.Data.Sqlite;

namespace PcAgent.Core.Storage;

/// <summary>
/// Local SQLite persistence (WAL) per docs/04-pc-agent.md §3.
/// All access is parameterized; writes outside gameplay are batched by callers.
/// </summary>
public sealed class AgentDatabase : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly object _gate = new();

    public AgentDatabase(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
        }.ToString());
        _connection.Open();
        Execute("PRAGMA journal_mode=WAL;");
        Execute("PRAGMA synchronous=NORMAL;");
        Migrate();
    }

    private void Migrate()
    {
        Execute("""
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS outbox (
                event_id TEXT PRIMARY KEY,
                seq INTEGER NOT NULL,
                type TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                sync_state TEXT NOT NULL CHECK(sync_state IN ('pending','acked','conflicted')),
                conflict_reason TEXT
            );
            CREATE TABLE IF NOT EXISTS sessions_local (
                local_ref TEXT PRIMARY KEY,
                server_session_id TEXT,
                started_eff_ms INTEGER NOT NULL,
                expires_eff_ms INTEGER NOT NULL,
                status TEXT NOT NULL,
                origin TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS config_cache (
                version INTEGER PRIMARY KEY,
                json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS games_cache (
                game_id TEXT PRIMARY KEY,
                json TEXT NOT NULL,
                manifest_version TEXT
            );
            CREATE TABLE IF NOT EXISTS time_anchor (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                offset_ms INTEGER NOT NULL,
                qpc_at_sync INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rate_limit (
                scope TEXT PRIMARY KEY,
                fail_count INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT
            );
            CREATE TABLE IF NOT EXISTS audit_pending (
                event_id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                metadata TEXT NOT NULL
            );
            """);
    }

    private void Execute(string sql)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
    }

    // ---- meta -------------------------------------------------------------

    public string? GetMeta(string key)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT value FROM meta WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", key);
            return cmd.ExecuteScalar() as string;
        }
    }

    public void SetMeta(string key, string value)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText =
                "INSERT INTO meta(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = $v";
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$v", value);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Atomically increments and returns the outbox sequence counter.</summary>
    public long NextSeq()
    {
        lock (_gate)
        {
            var current = long.TryParse(GetMeta("outbox_seq"), out var n) ? n : 0;
            current++;
            SetMeta("outbox_seq", current.ToString());
            return current;
        }
    }

    // ---- generic scalar helper ---------------------------------------------

    internal SqliteConnection Connection => _connection;

    public List<Dictionary<string, object?>> Query(string sql, params (string Name, object? Value)[] parameters)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
            {
                cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
            }

            using var reader = cmd.ExecuteReader();
            var rows = new List<Dictionary<string, object?>>();
            while (reader.Read())
            {
                var row = new Dictionary<string, object?>();
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
                rows.Add(row);
            }
            return rows;
        }
    }

    public int ExecuteNonQuery(string sql, params (string Name, object? Value)[] parameters)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
            {
                cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
            }
            return cmd.ExecuteNonQuery();
        }
    }

    public void Dispose()
    {
        _connection.Dispose();
    }
}
