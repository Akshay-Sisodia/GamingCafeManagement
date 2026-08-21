using System.Windows;
using System.Windows.Input;
using GamingLauncher.Ipc;
using GamingLauncher.Services;
using GamingLauncher.ViewModels;

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
        SimpleFileLogger.Info("launcher started");
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
