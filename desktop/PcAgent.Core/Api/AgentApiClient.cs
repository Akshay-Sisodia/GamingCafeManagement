using System.Text;
using System.Text.Json;

namespace PcAgent.Core.Api;

/// <summary>Result of the offline event sync batch call (docs/03 §6.2).</summary>
public sealed record SyncEventResult(string EventId, long Seq, string State, string? Reason, string? SessionId);

public sealed record SyncBatchResponse(IReadOnlyList<SyncEventResult> Results, long AckSeq);

public sealed record CommandAckResult(bool Ok);

/// <summary>
/// HTTP client for the cloud backend. Device-authenticated calls carry
/// `Authorization: Bearer &lt;device_token&gt;` and `X-PC-Id` headers.
/// </summary>
public sealed class AgentApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUri;

    public AgentApiClient(string baseUrl)
    {
        _baseUri = baseUrl.TrimEnd('/');
        _http = new HttpClient { BaseAddress = new Uri(_baseUri + "/") };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "PcAgent/1.0");
    }

    private void SetDeviceAuth(HttpRequestMessage req, string token, string pcId)
    {
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        req.Headers.Add("X-PC-Id", pcId);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage resp, CancellationToken ct)
    {
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"HTTP {(int)resp.StatusCode} from {resp.RequestMessage?.RequestUri}: {body}");
        }
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static StringContent JsonBody(object payload) =>
        new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

    public async Task<JsonElement> PairAsync(string pairingCode, string fingerprint, string agentVersion, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "v1/auth/devices/pair") { Content = JsonBody(new { pairing_code = pairingCode, hardware_fingerprint = fingerprint, agent_version = agentVersion }) };
        using var resp = await _http.SendAsync(req, ct);
        return await ReadJsonAsync(resp, ct);
    }

    /// <summary>Zero-touch enrollment: server creates/updates this machine's PC row.</summary>
    public async Task<JsonElement> EnrollAsync(string enrollToken, string hostname, string fingerprint, string agentVersion, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "v1/auth/devices/enroll")
        {
            Content = JsonBody(new { enroll_token = enrollToken, hostname, hardware_fingerprint = fingerprint, agent_version = agentVersion }),
        };
        using var resp = await _http.SendAsync(req, ct);
        return await ReadJsonAsync(resp, ct);
    }

    public async Task<JsonElement> BootstrapAsync(string token, string pcId, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "v1/agent/bootstrap");
        SetDeviceAuth(req, token, pcId);
        using var resp = await _http.SendAsync(req, ct);
        return await ReadJsonAsync(resp, ct);
    }

    public async Task<long> TimeCheckAsync(CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "v1/agent/time-check");
        using var resp = await _http.SendAsync(req, ct);
        var json = await ReadJsonAsync(resp, ct);
        return json.GetProperty("server_time_ms").GetInt64();
    }

    public async Task PostHealthAsync(string token, string pcId, object report, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "v1/agent/health") { Content = JsonBody(report) };
        SetDeviceAuth(req, token, pcId);
        using var resp = await _http.SendAsync(req, ct);
        await ReadJsonAsync(resp, ct);
    }

    public async Task<SyncBatchResponse> SyncEventsAsync(
        string token, string pcId, string agentVersion, long lastServerSeq,
        IReadOnlyList<(string EventId, long Seq, string Type, DateTimeOffset OccurredAt, JsonElement Payload)> events,
        CancellationToken ct)
    {
        var envelopes = events.Select(e => new Dictionary<string, object?>
        {
            ["event_id"] = e.EventId,
            ["seq"] = e.Seq,
            ["type"] = e.Type,
            ["occurred_at"] = e.OccurredAt.ToString("O"),
            ["payload"] = JsonSerializer.Deserialize<JsonElement>(e.Payload.GetRawText()),
        }).ToList();

        var body = new Dictionary<string, object?>
        {
            ["agent_version"] = agentVersion,
            ["last_server_seq"] = lastServerSeq,
            ["events"] = envelopes,
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "v1/sync/events") { Content = JsonBody(body) };
        SetDeviceAuth(req, token, pcId);
        using var resp = await _http.SendAsync(req, ct);
        var json = await ReadJsonAsync(resp, ct);

        var results = new List<SyncEventResult>();
        foreach (var r in json.GetProperty("results").EnumerateArray())
        {
            results.Add(new SyncEventResult(
                r.GetProperty("event_id").GetString()!,
                r.GetProperty("seq").GetInt64(),
                r.GetProperty("state").GetString()!,
                r.TryGetProperty("reason", out var reason) ? reason.GetString() : null,
                r.TryGetProperty("session_id", out var sid) ? sid.GetString() : null));
        }
        return new SyncBatchResponse(results, json.GetProperty("ack_seq").GetInt64());
    }

    public async Task AckCommandAsync(string token, string pcId, string commandId, string status, string? code, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"v1/commands/{commandId}/ack")
        {
            Content = JsonBody(new { status, code }),
        };
        SetDeviceAuth(req, token, pcId);
        using var resp = await _http.SendAsync(req, ct);
        await ReadJsonAsync(resp, ct);
    }

    public async Task<bool> VerifySuperadminOnlineAsync(string token, string pcId, string password, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"v1/pcs/{pcId}/superadmin/verify")
            {
                Content = JsonBody(new { password }),
            };
            SetDeviceAuth(req, token, pcId);
            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) return false;
            var json = await ReadJsonAsync(resp, ct);
            return json.TryGetProperty("ok", out var ok) && ok.GetBoolean();
        }
        catch
        {
            return false; // network failure → caller falls back to offline verification
        }
    }

    public void Dispose() => _http.Dispose();
}
