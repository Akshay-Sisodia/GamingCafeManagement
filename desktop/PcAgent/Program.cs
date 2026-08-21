using Microsoft.Extensions.Options;
using PcAgent.Core.Options;
using PcAgent;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection(AgentOptions.SectionName));
builder.Services.AddSingleton(sp => sp.GetRequiredService<IOptions<AgentOptions>>().Value);
builder.Services.AddWindowsService(options => options.ServiceName = "GamingCafeAgent");
builder.Services.AddHostedService<AgentWorker>();

var host = builder.Build();
host.Run();
