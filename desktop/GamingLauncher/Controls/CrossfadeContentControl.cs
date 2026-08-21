using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;

namespace GamingLauncher.Controls;

/// <summary>Fades/slides content when the bound view changes.</summary>
public sealed class CrossfadeContentControl : ContentControl
{
    public static readonly DependencyProperty ContentKeyProperty =
        DependencyProperty.Register(nameof(ContentKey), typeof(object), typeof(CrossfadeContentControl),
            new PropertyMetadata(null, OnContentKeyChanged));

    public object? ContentKey
    {
        get => GetValue(ContentKeyProperty);
        set => SetValue(ContentKeyProperty, value);
    }

    protected override void OnContentChanged(object oldContent, object newContent)
    {
        base.OnContentChanged(oldContent, newContent);
        if (newContent is not null) PlayEnter();
    }

    private static void OnContentKeyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is CrossfadeContentControl host) host.PlayEnter();
    }

    private void PlayEnter()
    {
        Opacity = 0;
        RenderTransform = new System.Windows.Media.TranslateTransform(18, 0);

        var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(240))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        var slide = new DoubleAnimation(18, 0, TimeSpan.FromMilliseconds(300))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };

        BeginAnimation(OpacityProperty, fade);
        if (RenderTransform is System.Windows.Media.TranslateTransform t)
            t.BeginAnimation(System.Windows.Media.TranslateTransform.XProperty, slide);
    }
}
