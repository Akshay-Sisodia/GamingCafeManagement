using System.Windows.Media;
using GamingLauncher.Services;

namespace GamingLauncher.ViewModels;

public sealed class GameTileVm : ObservableObject
{
    public GameTileVm(
        string gameId,
        string name,
        string executablePath,
        string launchArgs,
        string? iconUrl = null,
        string? iconPath = null,
        string? category = null)
    {
        GameId = gameId;
        Name = name;
        ExecutablePath = executablePath;
        LaunchArgs = launchArgs;
        IconUrl = iconUrl;
        IconPath = iconPath;
        Category = string.IsNullOrWhiteSpace(category) ? "Game" : category;
        Initial = string.IsNullOrWhiteSpace(name) ? "?" : char.ToUpperInvariant(name.Trim()[0]).ToString();
        FallbackBrush = GameCoverLoader.FallbackBrush(name);
    }

    public string GameId { get; }
    public string Name { get; }
    public string ExecutablePath { get; }
    public string LaunchArgs { get; }
    public string? IconUrl { get; }
    public string? IconPath { get; }
    public string Category { get; }
    public string Initial { get; }
    public Brush FallbackBrush { get; }

    public ImageSource? CoverImage { get; private set; }

    public bool HasCoverImage { get; private set; }

    public async void LoadCoverAsync()
    {
        var source = !string.IsNullOrWhiteSpace(IconPath)
            ? IconPath
            : !string.IsNullOrWhiteSpace(IconUrl)
                ? IconUrl
                : GameCoverLoader.DemoCoverUrl(GameId.Length > 0 ? GameId : Name);

        var image = await GameCoverLoader.LoadAsync(source);
        if (image is null) return;

        CoverImage = image;
        HasCoverImage = true;
        OnPropertyChanged(nameof(CoverImage));
        OnPropertyChanged(nameof(HasCoverImage));
    }
}
