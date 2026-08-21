using System.Security.Cryptography;
using System.Text;
using PcAgent.Core.Storage;

namespace PcAgent.Core.Superadmin;

/// <summary>
/// Local superadmin verification (docs/04 §6). The verifier is an Argon2id
/// hash provisioned by the cloud, stored DPAPI-encrypted (LocalMachine scope).
/// Online verification is preferred; this class is the offline fallback.
/// </summary>
public sealed class SuperadminService
{
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const int Iterations = 4;
    private const int MemorySizeKb = 65536;
    private const string VerifierKey = "superadmin_verifier_blob"; // DPAPI blob, base64

    private readonly AgentDatabase _db;
    private readonly Func<string, RateLimitDecision> _rateLimitCheck;
    private readonly Action<string> _rateLimitFail;
    private readonly Action _rateLimitReset;
    private readonly Action<string, string> _audit; // (action, metadataJson)
    private readonly Action<string> _log;

    public SuperadminService(
        AgentDatabase db,
        Func<string, RateLimitDecision> rateLimitCheck,
        Action<string> rateLimitFail,
        Action rateLimitReset,
        Action<string, string> audit,
        Action<string>? log = null)
    {
        _db = db;
        _rateLimitCheck = rateLimitCheck;
        _rateLimitFail = rateLimitFail;
        _rateLimitReset = rateLimitReset;
        _audit = audit;
        _log = log ?? (_ => { });
    }

    public sealed record RateLimitDecision(bool Allowed, int RetryAfterSeconds);

    /// <summary>Stores a new cloud-provisioned verifier (DPAPI-protected at rest).</summary>
    public void SetVerifier(string argon2HashBase64, byte[] entropy)
    {
        var bytes = Convert.FromBase64String(argon2HashBase64);
        var protectedBytes = ProtectedData.Protect(bytes, entropy, DataProtectionScope.LocalMachine);
        _db.SetMeta(VerifierKey, Convert.ToBase64String(protectedBytes));
        _log("superadmin verifier updated");
    }

    public bool HasVerifier() => _db.GetMeta(VerifierKey) is not null;

    /// <summary>Offline verification path. Audits every attempt.</summary>
    public VerifyResult VerifyOffline(string password)
    {
        var limit = _rateLimitCheck("superadmin");
        if (!limit.Allowed)
        {
            _audit("SUPERADMIN_LOGIN_FAILED", "{\"reason\":\"rate_limited\"}");
            return new VerifyResult(false, limit.RetryAfterSeconds);
        }

        var blobB64 = _db.GetMeta(VerifierKey);
        if (blobB64 is null)
        {
            _audit("SUPERADMIN_LOGIN_FAILED", "{\"reason\":\"no_verifier\"}");
            return new VerifyResult(false, 0);
        }

        try
        {
            var protectedBytes = Convert.FromBase64String(blobB64);
            var hashBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.LocalMachine);

            // Stored format: [16-byte salt][32-byte hash]
            if (hashBytes.Length != SaltSize + HashSize)
            {
                _audit("SUPERADMIN_LOGIN_FAILED", "{\"reason\":\"bad_verifier_format\"}");
                return new VerifyResult(false, 0);
            }

            var salt = hashBytes[..SaltSize];
            var expected = hashBytes[SaltSize..];
            var actual = Argon2idHash(password, salt);

            if (ConstantTimeEquals(expected, actual))
            {
                _rateLimitReset();
                _audit("SUPERADMIN_ENTERED", "{\"connection\":\"offline\"}");
                return new VerifyResult(true, 0);
            }
        }
        catch (Exception ex)
        {
            _log($"verifier check failed: {ex.Message}");
        }

        _rateLimitFail("superadmin");
        _audit("SUPERADMIN_LOGIN_FAILED", "{\"reason\":\"bad_password\"}");
        return new VerifyResult(false, 0);
    }

    public sealed record VerifyResult(bool Ok, int RetryAfterSeconds);

    internal static byte[] Argon2idHash(string password, byte[] salt)
    {
        using var argon2 = new Konscious.Security.Cryptography.Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            MemorySize = MemorySizeKb,
            Iterations = Iterations,
            DegreeOfParallelism = 1,
        };
        return argon2.GetBytes(HashSize);
    }

    /// <summary>Creates a verifier bundle in the cloud-side format [salt][hash].</summary>
    public static string CreateVerifier(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Argon2idHash(password, salt);
        return Convert.ToBase64String([.. salt, .. hash]);
    }

    private static bool ConstantTimeEquals(byte[] a, byte[] b)
    {
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
