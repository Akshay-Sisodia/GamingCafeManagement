using Microsoft.Extensions.Options;
using Microsoft.Win32;
using PcAgent.Core.Options;
using PcAgent;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection(AgentOptions.SectionName));

// Machine-level overrides (written by the MSI / configure script) so the same
// installer image works on every café PC without editing files.
builder.Services.PostConfigure<AgentOptions>(options =>
{
    using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\GamingCafe\Agent");
    if (key is not null)
    {
        if (key.GetValue("ServerBaseUrl") is string url && !string.IsNullOrWhiteSpace(url))
        {
            options.ServerBaseUrl = url;
        }
        if (key.GetValue("PairingCode") is string pairingCode && !string.IsNullOrWhiteSpace(pairingCode))
        {
            options.PairingCode = pairingCode;
        }
        if (key.GetValue("EnrollToken") is string enrollToken && !string.IsNullOrWhiteSpace(enrollToken))
        {
            options.EnrollToken = enrollToken;
        }
        if (key.GetValue("LauncherPath") is string launcherPath && !string.IsNullOrWhiteSpace(launcherPath))
        {
            options.LauncherPath = launcherPath;
        }
    }

    // Local dev: fall back to the sibling GamingLauncher build output when the
    // installed path from appsettings.json is not present on this machine.
    if (!File.Exists(options.LauncherPath))
    {
        var devLauncher = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..",
            "GamingLauncher", "bin", "Release", "net10.0-windows", "GamingLauncher.exe"));
        if (File.Exists(devLauncher))
        {
            options.LauncherPath = devLauncher;
        }
    }
});

builder.Services.AddSingleton(sp => sp.GetRequiredService<IOptions<AgentOptions>>().Value);
builder.Services.AddWindowsService(options => options.ServiceName = "GamingCafeAgent");
builder.Services.AddHostedService<AgentWorker>();

var host = builder.Build();
host.Run();
