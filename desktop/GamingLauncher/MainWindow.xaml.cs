using System.Windows;
using System.Windows.Input;
using GamingLauncher.Ipc;
using GamingLauncher.Services;
using GamingLauncher.ViewModels;
using Microsoft.Win32;

namespace GamingLauncher;

public partial class MainWindow : Window
{
    private readonly NamedPipeIpcClient _ipc = new();
    private readonly MainViewModel _viewModel;

    public MainWindow()
    {
        InitializeComponent();
        _ipc.Start();
        _viewModel = new MainViewModel(_ipc);
        DataContext = _viewModel;
        _viewModel.Superadmin.PickShortcutRequested += OnPickShortcut;
        _viewModel.Superadmin.PickThumbnailRequested += OnPickThumbnail;
        _viewModel.Superadmin.PickPathRequested += OnPickPath;
        SimpleFileLogger.Info("launcher started");
    }

    private void OnPickPath(SuperadminGameRowVm row)
    {
        var dialog = new OpenFileDialog
        {
            Title = $"Set launch path for {row.Name}",
            Filter = "Shortcuts and games (*.lnk;*.exe)|*.lnk;*.exe|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog() != true) return;
        _ = _viewModel.Superadmin.SubmitPathAsync(row.GameId, dialog.FileName);
    }

    private void OnPickThumbnail(SuperadminGameRowVm row)
    {
        var dialog = new OpenFileDialog
        {
            Title = $"Choose thumbnail for {row.Name}",
            Filter = "Images (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog() != true) return;
        _ = _viewModel.Superadmin.SubmitThumbnailAsync(row.GameId, dialog.FileName);
    }

    private void OnPickShortcut()
    {
        var dialog = new OpenFileDialog
        {
            Title = "Add game to this PC's library",
            Filter = "Shortcuts and games (*.lnk;*.exe)|*.lnk;*.exe|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (dialog.ShowDialog() != true) return;
        _ = _viewModel.Superadmin.SubmitShortcutAsync(dialog.FileName);
    }

    private void SuperadminEnter_Click(object sender, RoutedEventArgs e)
    {
        _viewModel.Superadmin.Password = SuperadminPasswordBox.Password;
        _viewModel.Superadmin.VerifyCommand.Execute(null);
        SuperadminPasswordBox.Clear();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        // Ctrl+Shift+S opens superadmin (also bound via KeyBinding).
        if (e.Key == Key.S && Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift))
        {
            _viewModel.Superadmin.Show();
        }
        base.OnKeyDown(e);
    }
}
