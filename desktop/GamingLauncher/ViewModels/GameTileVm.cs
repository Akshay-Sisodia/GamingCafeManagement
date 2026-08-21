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
        string? category = null)
    {
        GameId = gameId;
        Name = name;
        ExecutablePath = executablePath;
        LaunchArgs = launchArgs;
        IconUrl = iconUrl;
        Category = string.IsNullOrWhiteSpace(category) ? "Arcade" : category;
        Initial = string.IsNullOrWhiteSpace(name) ? "?" : char.ToUpperInvariant(name.Trim()[0]).ToString();
        FallbackBrush = GameCoverLoader.FallbackBrush(name);
    }

    public string GameId { get; }
    public string Name { get; }
    public string ExecutablePath { get; }
    public string LaunchArgs { get; }
    public string? IconUrl { get; }
    public string Category { get; }
    public string Initial { get; }
    public Brush FallbackBrush { get; }

    public ImageSource? CoverImage { get; private set; }

    public bool HasCoverImage { get; private set; }

    public async void LoadCoverAsync()
    {
        var url = !string.IsNullOrWhiteSpace(IconUrl)
            ? IconUrl
            : GameCoverLoader.DemoCoverUrl(GameId.Length > 0 ? GameId : Name);

        var image = await GameCoverLoader.LoadAsync(url);
        if (image is null) return;

        CoverImage = image;
        HasCoverImage = true;
        OnPropertyChanged(nameof(CoverImage));
        OnPropertyChanged(nameof(HasCoverImage));
    }
}
