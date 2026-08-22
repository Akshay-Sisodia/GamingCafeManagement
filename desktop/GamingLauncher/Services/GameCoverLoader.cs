using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace GamingLauncher.Services;

public static class GameCoverLoader
{
    private static readonly Brush[] FallbackGradients = [
        MakeSolid("#2A2A2E"),
        MakeSolid("#252528"),
        MakeSolid("#303035"),
        MakeSolid("#1F1F23"),
        MakeSolid("#35353A"),
        MakeSolid("#2C2C31"),
    ];

    public static Brush FallbackBrush(string name)
    {
        var hash = name.Aggregate(0, (acc, ch) => acc + ch);
        return FallbackGradients[Math.Abs(hash) % FallbackGradients.Length];
    }

    public static string DemoCoverUrl(string seed) =>
        $"https://picsum.photos/seed/{Uri.EscapeDataString(seed)}/480/640";

    public static Task<ImageSource?> LoadAsync(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return Task.FromResult<ImageSource?>(null);
        if (File.Exists(url)) return LoadFromFileAsync(url);

        var tcs = new TaskCompletionSource<ImageSource?>();
        Application.Current?.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                var image = new BitmapImage();
                image.DownloadCompleted += (_, _) => tcs.TrySetResult(image);
                image.DownloadFailed += (_, _) => tcs.TrySetResult(null);
                image.BeginInit();
                image.UriSource = new Uri(url, UriKind.Absolute);
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.EndInit();
                if (!image.IsDownloading && image.PixelWidth > 0)
                    tcs.TrySetResult(image);
            }
            catch
            {
                tcs.TrySetResult(null);
            }
        });
        return tcs.Task;
    }

    private static Task<ImageSource?> LoadFromFileAsync(string path)
    {
        var tcs = new TaskCompletionSource<ImageSource?>();
        Application.Current?.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                var image = new BitmapImage();
                image.BeginInit();
                image.UriSource = new Uri(Path.GetFullPath(path), UriKind.Absolute);
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.EndInit();
                image.Freeze();
                tcs.TrySetResult(image);
            }
            catch
            {
                tcs.TrySetResult(null);
            }
        });
        return tcs.Task;
    }

    private static Brush MakeSolid(string color)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)!);
        brush.Freeze();
        return brush;
    }

    private static Brush MakeGradient(string a, string b)
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new Point(0, 0),
            EndPoint = new Point(1, 1),
        };
        brush.GradientStops.Add(new GradientStop((Color)ColorConverter.ConvertFromString(a)!, 0));
        brush.GradientStops.Add(new GradientStop((Color)ColorConverter.ConvertFromString(b)!, 1));
        brush.Freeze();
        return brush;
    }
}
