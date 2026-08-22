using System.Windows;

namespace GamingLauncher;

public partial class App : Application
{
    private void OnStartup(object sender, StartupEventArgs e)
    {
        Resources.MergedDictionaries.Add(new ResourceDictionary
        {
            Source = new Uri("Themes/KioskTheme.Night.xaml", UriKind.Relative),
        });
        new MainWindow().Show();
    }
}
