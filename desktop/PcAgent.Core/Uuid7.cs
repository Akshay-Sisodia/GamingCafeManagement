namespace PcAgent.Core;

/// <summary>
/// UUIDv7 generator (RFC 9562): 48-bit unix-ms timestamp + random bits.
/// Time-sortable and safe to generate offline on PCs.
/// </summary>
public static class Uuid7
{
    public static Guid NewGuid(DateTimeOffset? now = null)
    {
        var ts = (now ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds();
        var bytes = new byte[16];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);

        for (var i = 5; i >= 0; i--)
        {
            bytes[i] = (byte)((ts >> ((5 - i) * 8)) & 0xFF);
        }

        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x70); // version 7
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80); // RFC variant

        return new Guid(bytes);
    }

    public static string NewId(DateTimeOffset? now = null) => NewGuid(now).ToString();
}
