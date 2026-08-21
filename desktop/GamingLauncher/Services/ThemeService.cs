using System.Windows;

namespace GamingLauncher.Services;

/// <summary>Swaps merged resource dictionaries for night (neon arcade) vs day (bright lounge).</summary>
public sealed class ThemeService
{
    private readonly ResourceDictionary _night =
        new() { Source = new Uri("Themes/KioskTheme.Night.xaml", UriKind.Relative) };
    private readonly ResourceDictionary _day =
        new() { Source = new Uri("Themes/KioskTheme.Day.xaml", UriKind.Relative) };

    public bool IsDayMode { get; private set; }

    public void Apply(bool dayMode)
    {
        var app = Application.Current;
        if (app is null) return;

        var merged = app.Resources.MergedDictionaries;
        merged.Remove(_night);
        merged.Remove(_day);
        merged.Add(dayMode ? _day : _night);
        IsDayMode = dayMode;
    }

    public void Toggle() => Apply(!IsDayMode);
}
