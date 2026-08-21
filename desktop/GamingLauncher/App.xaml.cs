using System.Windows;
using GamingLauncher.Services;

namespace GamingLauncher;

public partial class App : Application
{
    public static ThemeService Themes { get; } = new();

    private void OnStartup(object sender, StartupEventArgs e)
    {
        Themes.Apply(false);
        new MainWindow().Show();
    }
}
