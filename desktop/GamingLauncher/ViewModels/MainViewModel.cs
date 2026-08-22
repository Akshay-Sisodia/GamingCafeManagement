using System.Collections.ObjectModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using GamingLauncher.Ipc;
using GamingLauncher.Services;

namespace GamingLauncher.ViewModels;

public sealed class GamingModeViewModel;

public sealed record CartLineVm(string ItemId, string Name, int UnitPricePaise);

/// <summary>Root kiosk view model: session timer, view switching, IPC wiring.</summary>
public sealed class MainViewModel : ObservableObject
{
    private readonly NamedPipeIpcClient _ipc;
    private readonly DispatcherTimer _tick;
    private long _remainingSeconds;
    private bool _sessionActive;
    private string _remainingText = "--:--:--";
    private string _sessionAlertText = "";
    private string _sessionAlertColor = "#F4F4F5";
    private string _timerColor = "#F4F4F5";
    private string _agentStatusText = "Connecting to agent…";
    private bool _agentConnected;
    private object? _currentView;
    private string _pcName = "Station";
    private int _contentSwitchKey;

    public GamesViewModel Games { get; } = new();
    public FoodViewModel Food { get; } = new();
    public SuperadminViewModel Superadmin { get; } = new();

    public GamingModeViewModel GamingMode { get; } = new();

    public MainViewModel(NamedPipeIpcClient ipc)
    {
        _ipc = ipc;
        _ipc.PushReceived += OnPush;
        _ipc.ConnectionChanged += connected =>
        {
            AgentConnected = connected;
            AgentStatusText = connected
                ? "Connected — session sync active"
                : "Agent offline — demo games only, orders may fail";
            if (!connected)
            {
                SessionAlertText = "";
                Games.Items.Clear();
            }
        };

        Games.LaunchRequested += async game =>
        {
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodGameLaunch,
                new { executable_path = game.ExecutablePath, launch_args = game.LaunchArgs });
            if (result is null)
            {
                SessionAlertText = "Could not launch — game missing or agent error";
                SessionAlertColor = "#F87171";
            }
            else
            {
                CurrentView = GamingMode;
            }
        };

        Food.PlaceOrderRequested += async (items, total) =>
        {
            var payload = new
            {
                source = "launcher",
                items = items.Select(i => new { menu_item_id = i.ItemId, qty = i.Qty }).ToArray(),
            };
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodOrderPlace, payload);
            Food.OnOrderPlaced(result is not null);
        };

        Superadmin.VerifyRequested += async password =>
        {
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodSuperadminVerify, new { password });
            if (result is null)
            {
                Superadmin.OnVerifyResult(false, "Could not reach agent — is PcAgent running?");
                return;
            }

            var ok = result.Value.TryGetProperty("ok", out var okEl) && okEl.GetBoolean();
            if (ok)
            {
                Superadmin.OnVerifyResult(true);
                RefreshSuperadminLibrary();
                return;
            }

            var reason = result.Value.TryGetProperty("reason", out var reasonEl) ? reasonEl.GetString() : null;
            Superadmin.OnVerifyResult(false, reason switch
            {
                "rate_limited" => "Too many attempts — wait and try again.",
                "no_verifier" => "Wrong password, or this PC is offline with no local verifier.",
                _ => "ACCESS DENIED — attempt logged",
            });
        };
        Superadmin.MaintenanceActionRequested += async action =>
        {
            await _ipc.SendRequestAsync(IpcProtocol.MethodMaintenanceAction, new { action });
            if (action == "enter_windows") Application.Current.Shutdown();
        };
        Superadmin.ScanGamesRequested += async () =>
        {
            Superadmin.GamesStatus = "Scanning this PC…";
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodGamesImportDiscovered, null);
            if (result is null)
            {
                Superadmin.GamesStatus = "Scan failed — is the agent running?";
                return;
            }

            var added = result.Value.TryGetProperty("added_count", out var addedEl) ? addedEl.GetInt32() : 0;
            var total = result.Value.TryGetProperty("total", out var totalEl) ? totalEl.GetInt32() : Games.Items.Count;
            Superadmin.GamesStatus = added > 0
                ? $"Added {added} game(s). Library now has {total}."
                : $"No new games found. Library has {total}.";
            RefreshSuperadminLibrary();
        };
        Superadmin.AddShortcutRequested += async path =>
        {
            Superadmin.GamesStatus = "Adding game…";
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodGamesAdd, new { shortcut_path = path });
            if (result is null)
            {
                Superadmin.GamesStatus = "Could not add — check the shortcut path.";
                return;
            }

            var name = result.Value.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : "Game";
            Superadmin.GamesStatus = $"Added {name} to this PC's library.";
            RefreshSuperadminLibrary();
        };
        Superadmin.RemoveGameRequested += async gameId =>
        {
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodGamesRemove, new { game_id = gameId });
            var ok = result is not null
                && result.Value.TryGetProperty("ok", out var okEl)
                && okEl.GetBoolean();
            Superadmin.GamesStatus = ok ? "Removed from library." : "Could not remove — try again.";
            RefreshSuperadminLibrary();
        };
        Superadmin.SetThumbnailRequested += async (gameId, imagePath) =>
        {
            Superadmin.GamesStatus = "Saving thumbnail…";
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodGamesSetThumbnail,
                new { game_id = gameId, image_path = imagePath });
            Superadmin.GamesStatus = ReadIpcStatus(result, "Thumbnail updated.", "Could not save thumbnail.");
        };
        Superadmin.SetPathRequested += async (gameId, shortcutPath) =>
        {
            Superadmin.GamesStatus = "Updating launch path…";
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodGamesSetPath,
                new { game_id = gameId, shortcut_path = shortcutPath });
            Superadmin.GamesStatus = ReadIpcStatus(result, "Launch path updated.", "Could not update path.");
            RefreshSuperadminLibrary();
        };

        OpenGamesCommand = new RelayCommand(_ => CurrentView = Games);
        OpenFoodCommand = new RelayCommand(_ => CurrentView = Food);
        OpenSessionInfoCommand = new RelayCommand(_ => CurrentView = SessionInfo);
        BackToGamesCommand = new RelayCommand(_ => CurrentView = Games);
        OpenSuperadminCommand = new RelayCommand(_ => Superadmin.Show());

        _tick = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _tick.Tick += (_, _) => OnTick();
        _tick.Start();

        CurrentView = Games;
        _ = BootstrapAsync();
    }

    public SessionInfoViewModel SessionInfo { get; } = new();

    public RelayCommand OpenGamesCommand { get; }
    public RelayCommand OpenFoodCommand { get; }
    public RelayCommand OpenSessionInfoCommand { get; }
    public RelayCommand BackToGamesCommand { get; }
    public RelayCommand OpenSuperadminCommand { get; }

    public int ContentSwitchKey { get => _contentSwitchKey; private set => Set(ref _contentSwitchKey, value); }

    public object? CurrentView
    {
        get => _currentView;
        set
        {
            if (!Set(ref _currentView, value)) return;
            ContentSwitchKey++;
            NotifyNavSelection();
        }
    }

    public bool IsGamesSelected => ReferenceEquals(CurrentView, Games);
    public bool IsFoodSelected => ReferenceEquals(CurrentView, Food);
    public bool IsSessionInfoSelected => ReferenceEquals(CurrentView, SessionInfo);

    public bool AgentConnected { get => _agentConnected; private set => Set(ref _agentConnected, value); }

    public string AgentStatusText { get => _agentStatusText; private set => Set(ref _agentStatusText, value); }

    public string SessionAlertText { get => _sessionAlertText; private set => Set(ref _sessionAlertText, value); }

    public string SessionAlertColor { get => _sessionAlertColor; private set => Set(ref _sessionAlertColor, value); }

    public string TimerColor { get => _timerColor; private set => Set(ref _timerColor, value); }

    public bool SessionActive { get => _sessionActive; private set => Set(ref _sessionActive, value); }

    public string RemainingText { get => _remainingText; private set => Set(ref _remainingText, value); }

    public string PcName { get => _pcName; set { if (Set(ref _pcName, value)) SessionInfo.PcName = value; } }

    private void NotifyNavSelection()
    {
        OnPropertyChanged(nameof(IsGamesSelected));
        OnPropertyChanged(nameof(IsFoodSelected));
        OnPropertyChanged(nameof(IsSessionInfoSelected));
    }

    private static string FormatPcLabel(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return "Station";
        if (id.Contains('-', StringComparison.Ordinal) && id.Length > 8)
            return $"Station · {id[^4..].ToUpperInvariant()}";
        return id;
    }

    private void ApplySessionInfo(string? expiresAtIso, long remainingSeconds)
    {
        SessionInfo.PcName = PcName;
        if (expiresAtIso is not null &&
            DateTimeOffset.TryParse(expiresAtIso, out var expiresAt) &&
            remainingSeconds >= 0)
        {
            SessionInfo.ExpiresAt = expiresAt.LocalDateTime.ToString("f");
            SessionInfo.StartedAt = expiresAt.AddSeconds(-remainingSeconds).LocalDateTime.ToString("f");
            return;
        }

        SessionInfo.StartedAt = "—";
        SessionInfo.ExpiresAt = "—";
    }

    private void OnTick()
    {
        // Unconditional 10s resync — the launcher never depends solely on
        // pushes for correctness; pushes are an optimization over this poll.
        if (_ipc.IsConnected &&
            (DateTime.UtcNow - _lastResyncUtc).TotalSeconds >= 10)
        {
            _ = ResyncAsync();
        }

        if (!SessionActive || _sessionPaused) return;
        if (_remainingSeconds > 0) _remainingSeconds--;
        UpdateCountdownUi();
    }

    private async Task ResyncAsync()
    {
        if (!await _resyncGate.WaitAsync(0)) return;

        try
        {
            var result = await _ipc.SendRequestAsync(IpcProtocol.MethodBootstrap, null);
            if (result is not null &&
                result.Value.TryGetProperty("session", out var sessionEl) &&
                sessionEl.ValueKind == JsonValueKind.Object)
            {
                var state = sessionEl.TryGetProperty("state", out var st) ? st.GetString() : null;
                var remaining = sessionEl.TryGetProperty("remaining_seconds", out var rem)
                    ? rem.GetInt64()
                    : -1;

                if (state == "active" && remaining >= 0)
                {
                    SessionActive = true;
                    _remainingSeconds = remaining;
                    SimpleFileLogger.Info($"bootstrap resync: {remaining}s remaining");
                }
                else
                {
                    SessionActive = false;
                    SessionAlertText = "";
                    CurrentView = Games;
                }
                if (sessionEl.TryGetProperty("expires_at", out var expEl))
                {
                    ApplySessionInfo(expEl.GetString(), remaining);
                }
                UpdateCountdownUi();
            }
        }
        catch
        {
            // unreachable agent — next tick retries
        }
        finally
        {
            _lastResyncUtc = DateTime.UtcNow;
            _lastTimerPushUtc = DateTime.UtcNow;
            _resyncGate.Release();
        }
    }

    private bool _timerPushLogged;
    private readonly SemaphoreSlim _resyncGate = new(1, 1);
    private DateTime _lastTimerPushUtc = DateTime.UtcNow;
    private DateTime _lastResyncUtc = DateTime.UtcNow;

    private void UpdateCountdownUi()
    {
        var t = TimeSpan.FromSeconds(_remainingSeconds);
        RemainingText = $"{(int)t.TotalHours:00}:{t.Minutes:00}:{t.Seconds:00}";

        if (_remainingSeconds <= 60)
        {
            SessionAlertText = "1 minute remaining";
            SessionAlertColor = "#EF4444";
            TimerColor = "#EF4444";
        }
        else if (_remainingSeconds <= 300)
        {
            SessionAlertText = "5 minutes remaining";
            SessionAlertColor = "#F59E0B";
            TimerColor = "#F59E0B";
        }
        else if (_remainingSeconds <= 600)
        {
            SessionAlertText = "10 minutes remaining";
            SessionAlertColor = "#F59E0B";
            TimerColor = "#F4F4F5";
        }
        else
        {
            SessionAlertText = "";
            SessionAlertColor = "#F4F4F5";
            TimerColor = "#F4F4F5";
        }
    }

    private bool _sessionPaused;

    private void OnPush(IpcPush push)
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            switch (push.Type)
            {
                case "timer":
                    if (push.Data.TryGetProperty("remaining_seconds", out var secs))
                    {
                        _lastTimerPushUtc = DateTime.UtcNow;
                        _remainingSeconds = secs.GetInt64();
                        if (!SessionActive) SessionActive = true;
                        if (!_timerPushLogged)
                        {
                            _timerPushLogged = true;
                            SimpleFileLogger.Info("timer stream received — IPC push path OK");
                        }
                        UpdateCountdownUi();
                    }
                    break;

                case "session":
                    {
                        var state = push.Data.TryGetProperty("state", out var st) ? st.GetString() : null;
                        _sessionPaused = state == "paused";
                        SessionActive = state is "active" or "paused";
                        var remaining = SessionActive && push.Data.TryGetProperty("remaining_seconds", out var rem)
                            ? rem.GetInt64()
                            : 0L;
                        if (push.Data.TryGetProperty("remaining_seconds", out var remProp))
                        {
                            _remainingSeconds = remProp.GetInt64();
                        }
                        else if (!SessionActive)
                        {
                            _remainingSeconds = 0;
                        }

                        var expiresAt = push.Data.TryGetProperty("expires_at", out var exp)
                            ? exp.GetString()
                            : null;
                        ApplySessionInfo(expiresAt, remaining);
                        UpdateCountdownUi();
                        break;
                    }

                case "games":
                    {
                        var list = ParseGameTiles(push.Data);
                        Games.ReplaceAll(list);
                        RefreshSuperadminLibrary();
                        if (list.Count > 0)
                        {
                            SimpleFileLogger.Info($"games push: {list.Count} titles");
                        }
                        break;
                    }
            }
        });
    }

    private async Task RetryBootstrapAsync()
    {
        for (var i = 0; i < 5 && _ipc.IsConnected; i++)
        {
            await Task.Delay(500);
            var bootstrap = await _ipc.SendRequestAsync(IpcProtocol.MethodBootstrap, null);
            if (bootstrap is null) continue;
            ApplyBootstrap(bootstrap.Value);
            return;
        }
    }

    private void ApplyBootstrap(JsonElement bootstrap)
    {
        if (bootstrap.TryGetProperty("pc_id", out var pcIdEl))
        {
            PcName = FormatPcLabel(pcIdEl.GetString());
        }

        if (bootstrap.TryGetProperty("session", out var sessionEl) &&
            sessionEl.ValueKind == JsonValueKind.Object)
        {
            var state = sessionEl.TryGetProperty("state", out var st) ? st.GetString() : null;
            var remaining = sessionEl.TryGetProperty("remaining_seconds", out var rem)
                ? rem.GetInt64()
                : -1;
            var expiresAt = sessionEl.TryGetProperty("expires_at", out var exp) ? exp.GetString() : null;

            if (state == "active" && remaining >= 0)
            {
                SessionActive = true;
                _remainingSeconds = remaining;
                ApplySessionInfo(expiresAt, remaining);
                UpdateCountdownUi();
                SimpleFileLogger.Info($"bootstrap session active: {remaining}s remaining");
            }
        }

        AgentConnected = true;

        if (bootstrap.TryGetProperty("games", out var gamesEl) && gamesEl.ValueKind == JsonValueKind.Array)
        {
            var tiles = gamesEl.EnumerateArray()
                .Select(ParseGameTile)
                .Where(g => g is not null)
                .Cast<GameTileVm>()
                .ToList();
            Games.ReplaceAll(tiles);
            AgentStatusText = tiles.Count > 0
                ? "Connected — session sync active"
                : "Connected — edit games.local.json on this PC";
            if (tiles.Count > 0)
            {
                SimpleFileLogger.Info($"bootstrap games: {tiles.Count} titles");
            }
        }
        else
        {
            AgentStatusText = "Connected — session sync active";
        }
    }

    private async Task BootstrapAsync()
    {
        // Wait briefly for IPC; fall back to sample data so the UI is demoable standalone.
        for (var i = 0; i < 10 && !_ipc.IsConnected; i++)
        {
            await Task.Delay(500);
        }

        var bootstrap = await _ipc.SendRequestAsync(IpcProtocol.MethodBootstrap, null);
        if (bootstrap is null)
        {
            if (_ipc.IsConnected)
            {
                AgentConnected = true;
                AgentStatusText = "Connected — syncing session…";
                SimpleFileLogger.Info("bootstrap pending — agent connected, retrying");
                _ = RetryBootstrapAsync();
                return;
            }

            AgentConnected = false;
            AgentStatusText = "Agent offline — showing demo library";
            SimpleFileLogger.Info("agent unreachable — using sample data");
            Games.ReplaceAll(new List<GameTileVm>
            {
                new("g1", "CS2", "C:\\Games\\cs2.exe", "", GameCoverLoader.DemoCoverUrl("cs2"), "FPS"),
                new("g2", "VALORANT", "C:\\Riot\\VALORANT.exe", "", GameCoverLoader.DemoCoverUrl("valorant"), "FPS"),
                new("g3", "GTA V", "C:\\Games\\GTA5.exe", "", GameCoverLoader.DemoCoverUrl("gtav"), "Open World"),
                new("g4", "FIFA 24", "C:\\Games\\FIFA24.exe", "", GameCoverLoader.DemoCoverUrl("fifa24"), "Sports"),
                new("g5", "FORTNITE", "C:\\Games\\Fortnite.exe", "", GameCoverLoader.DemoCoverUrl("fortnite"), "Battle Royale"),
                new("g6", "APEX", "C:\\Games\\Apex.exe", "", GameCoverLoader.DemoCoverUrl("apex"), "Battle Royale"),
            });
            return;
        }

        ApplyBootstrap(bootstrap.Value);
    }

    private static List<GameTileVm> ParseGameTiles(JsonElement data)
    {
        if (!data.TryGetProperty("items", out var items)) return [];
        return items.EnumerateArray().Select(ParseGameTile).Where(g => g is not null).Cast<GameTileVm>().ToList();
    }

    private static GameTileVm? ParseGameTile(JsonElement item)
    {
        var exe = item.TryGetProperty("executable_path", out var ep) ? ep.GetString() : null;
        if (string.IsNullOrWhiteSpace(exe)) return null;

        return new GameTileVm(
            item.TryGetProperty("game_id", out var gid) ? gid.GetString() ?? "" : "",
            item.TryGetProperty("name", out var n) ? n.GetString() ?? "Game" : "Game",
            exe,
            item.TryGetProperty("launch_args", out var la) ? la.GetString() ?? "" : "",
            item.TryGetProperty("icon_url", out var iu) ? iu.GetString() : null,
            item.TryGetProperty("icon_path", out var ip) ? ip.GetString() : null,
            item.TryGetProperty("category", out var cat) ? cat.GetString() : null);
    }

    private void RefreshSuperadminLibrary()
    {
        if (!Superadmin.Unlocked) return;
        Superadmin.SetLibrary(Games.Items.Select(g => new SuperadminGameRowVm(g.GameId, g.Name, g.ExecutablePath)));
    }

    private static string ReadIpcStatus(JsonElement? result, string success, string fallback)
    {
        if (result is null) return "Could not reach agent — is PcAgent running?";
        if (result.Value.TryGetProperty("ok", out var okEl) && okEl.GetBoolean()) return success;
        return result.Value.TryGetProperty("error", out var errEl) && !string.IsNullOrWhiteSpace(errEl.GetString())
            ? errEl.GetString()!
            : fallback;
    }
}

public sealed class GamesViewModel : ObservableObject
{
    public ObservableCollection<GameTileVm> Items { get; } = new();

    public event Action<GameTileVm>? LaunchRequested;

    public RelayCommand LaunchCommand { get; }

    public GamesViewModel()
    {
        LaunchCommand = new RelayCommand(p =>
        {
            if (p is GameTileVm game) LaunchRequested?.Invoke(game);
        });
    }

    public void ReplaceAll(IEnumerable<GameTileVm> games)
    {
        Items.Clear();
        games.ToList().ForEach(g =>
        {
            Items.Add(g);
            g.LoadCoverAsync();
        });
    }
}

public sealed class FoodViewModel : ObservableObject
{
    public ObservableCollection<MenuItemVm> Menu { get; } = new();
    public ObservableCollection<CartLine> Cart { get; } = new();

    public event Action<IReadOnlyList<CartLine>, long>? PlaceOrderRequested;

    public RelayCommand AddToCart { get; }
    public RelayCommand IncrementQty { get; }
    public RelayCommand DecrementQty { get; }
    public RelayCommand PlaceOrder { get; }

    private string _statusText = "";

    public FoodViewModel()
    {
        Menu.Add(new MenuItemVm("m1", "Chicken Burger", 18000));
        Menu.Add(new MenuItemVm("m2", "Cheese Burger", 20000));
        Menu.Add(new MenuItemVm("m3", "French Fries", 10000));
        Menu.Add(new MenuItemVm("m4", "Coke", 6000));

        AddToCart = new RelayCommand(p =>
        {
            if (p is not MenuItemVm item) return;
            var line = Cart.FirstOrDefault(c => c.ItemId == item.Id);
            if (line is null) Cart.Add(new CartLine(item.Id, item.Name, item.UnitPricePaise));
            else line.Qty++;
            RefreshTotals();
        });

        IncrementQty = new RelayCommand(p =>
        {
            if (p is CartLine l) { l.Qty++; RefreshTotals(); }
        });

        DecrementQty = new RelayCommand(p =>
        {
            if (p is not CartLine l) return;
            if (l.Qty <= 1) Cart.Remove(l); else l.Qty--;
            RefreshTotals();
        }, p => p is CartLine);

        PlaceOrder = new RelayCommand(_ =>
        {
            if (Cart.Count == 0) return;
            PlaceOrderRequested?.Invoke(Cart.ToList(), TotalPaise);
        }, _ => Cart.Count > 0);
    }

    public string StatusText { get => _statusText; set => Set(ref _statusText, value); }

    public long TotalPaise => Cart.Sum(c => c.LineTotalPaise);

    public string TotalText => $"₹{TotalPaise / 100.0:0.00}";

    public bool HasCartItems => Cart.Count > 0;

    public void OnOrderPlaced(bool success)
    {
        StatusText = success ? "Order placed! It will be delivered to your PC." : "Order failed — please ask staff.";
        if (success)
        {
            Cart.Clear();
            RefreshTotals();
        }
    }

    private void RefreshTotals()
    {
        Cart.ToList().ForEach(line => line.Refresh());
        OnPropertyChanged(nameof(TotalPaise));
        OnPropertyChanged(nameof(TotalText));
        OnPropertyChanged(nameof(HasCartItems));
    }

    public sealed class MenuItemVm(string id, string name, int unitPricePaise)
    {
        public string Id { get; } = id;
        public string Name { get; } = name;
        public int UnitPricePaise { get; } = unitPricePaise;
        public string PriceText => $"₹{UnitPricePaise / 100.0:0.00}";
    }

    public sealed class CartLine : ObservableObject
    {
        public CartLine(string itemId, string name, int unitPricePaise)
        {
            ItemId = itemId;
            Name = name;
            UnitPricePaise = unitPricePaise;
        }

        public string ItemId { get; }
        public string Name { get; }
        public int UnitPricePaise { get; }

        private int _qty = 1;
        public int Qty { get => _qty; set { if (Set(ref _qty, Math.Max(1, value))) Refresh(); } }

        public long LineTotalPaise => UnitPricePaise * Qty;
        public string LineTotalText => $"₹{LineTotalPaise / 100.0:0.00}";

        public void Refresh()
        {
            OnPropertyChanged(nameof(Qty));
            OnPropertyChanged(nameof(LineTotalPaise));
            OnPropertyChanged(nameof(LineTotalText));
        }
    }
}

public sealed class SessionInfoViewModel : ObservableObject
{
    private string _pcName = "—";
    private string _startedAt = "—";
    private string _expiresAt = "—";

    public string PcName { get => _pcName; set => Set(ref _pcName, value); }
    public string StartedAt { get => _startedAt; set => Set(ref _startedAt, value); }
    public string ExpiresAt { get => _expiresAt; set => Set(ref _expiresAt, value); }
}

public sealed class SuperadminViewModel : ObservableObject
{
    private string _password = "";
    private string _errorMessage = "";
    private string _gamesStatus = "";
    private bool _isVisible;
    private bool _unlocked;

    public event Action<string>? VerifyRequested;
    public event Action<string>? MaintenanceActionRequested;
    public event Func<Task>? ScanGamesRequested;
    public event Func<string, Task>? AddShortcutRequested;
    public event Func<string, Task>? RemoveGameRequested;
    public event Func<string, string, Task>? SetThumbnailRequested;
    public event Func<string, string, Task>? SetPathRequested;
    public event Action? PickShortcutRequested;
    public event Action<SuperadminGameRowVm>? PickThumbnailRequested;
    public event Action<SuperadminGameRowVm>? PickPathRequested;

    public ObservableCollection<SuperadminGameRowVm> Library { get; } = new();

    public string Password { get => _password; set => Set(ref _password, value); }
    public string ErrorMessage { get => _errorMessage; private set => Set(ref _errorMessage, value); }
    public string GamesStatus { get => _gamesStatus; set => Set(ref _gamesStatus, value); }
    public bool IsVisible { get => _isVisible; private set => Set(ref _isVisible, value); }
    public bool Unlocked { get => _unlocked; private set => Set(ref _unlocked, value); }
    public bool HasLibraryItems => Library.Count > 0;

    public RelayCommand ShowCommand { get; }
    public RelayCommand VerifyCommand { get; }
    public RelayCommand CancelCommand { get; }
    public RelayCommand EnterWindowsCommand { get; }
    public RelayCommand RestartCommand { get; }
    public RelayCommand ShutdownCommand { get; }
    public RelayCommand ExitSuperadminCommand { get; }
    public RelayCommand ScanGamesCommand { get; }
    public RelayCommand AddShortcutCommand { get; }
    public RelayCommand RemoveGameCommand { get; }
    public RelayCommand UploadThumbnailCommand { get; }
    public RelayCommand SetPathCommand { get; }

    public SuperadminViewModel()
    {
        ShowCommand = new RelayCommand(_ => Show());
        VerifyCommand = new RelayCommand(_ =>
        {
            if (Password.Length == 0) return;
            ErrorMessage = "Verifying…";
            VerifyRequested?.Invoke(Password);
        });
        CancelCommand = new RelayCommand(_ => Close());
        EnterWindowsCommand = new RelayCommand(_ => MaintenanceActionRequested?.Invoke("enter_windows"), _ => Unlocked);
        RestartCommand = new RelayCommand(_ => MaintenanceActionRequested?.Invoke("restart"), _ => Unlocked);
        ShutdownCommand = new RelayCommand(_ => MaintenanceActionRequested?.Invoke("shutdown"), _ => Unlocked);
        ExitSuperadminCommand = new RelayCommand(_ => Close());
        ScanGamesCommand = new RelayCommand(async _ =>
        {
            if (ScanGamesRequested is null) return;
            await ScanGamesRequested();
        }, _ => Unlocked);
        AddShortcutCommand = new RelayCommand(_ => PickShortcutRequested?.Invoke(), _ => Unlocked);
        RemoveGameCommand = new RelayCommand(async p =>
        {
            if (p is not SuperadminGameRowVm row || RemoveGameRequested is null) return;
            await RemoveGameRequested(row.GameId);
        }, _ => Unlocked);
        UploadThumbnailCommand = new RelayCommand(p =>
        {
            if (p is SuperadminGameRowVm row) PickThumbnailRequested?.Invoke(row);
        }, _ => Unlocked);
        SetPathCommand = new RelayCommand(p =>
        {
            if (p is SuperadminGameRowVm row) PickPathRequested?.Invoke(row);
        }, _ => Unlocked);
    }

    public Task SubmitThumbnailAsync(string gameId, string imagePath) =>
        SetThumbnailRequested?.Invoke(gameId, imagePath) ?? Task.CompletedTask;

    public Task SubmitPathAsync(string gameId, string shortcutPath) =>
        SetPathRequested?.Invoke(gameId, shortcutPath) ?? Task.CompletedTask;

    public void SetLibrary(IEnumerable<SuperadminGameRowVm> items)
    {
        Library.Clear();
        items.ToList().ForEach(Library.Add);
        OnPropertyChanged(nameof(HasLibraryItems));
    }

    public void Show()
    {
        IsVisible = true;
        Password = "";
        ErrorMessage = "";
        GamesStatus = "";
    }

    public void Close()
    {
        IsVisible = false;
        Unlocked = false;
        Password = "";
    }

    public Task SubmitShortcutAsync(string path) =>
        AddShortcutRequested?.Invoke(path) ?? Task.CompletedTask;

    public void OnVerifyResult(bool ok, string? errorMessage = null)
    {
        if (ok)
        {
            Unlocked = true;
            ErrorMessage = "";
        }
        else
        {
            ErrorMessage = string.IsNullOrWhiteSpace(errorMessage)
                ? "ACCESS DENIED — attempt logged"
                : errorMessage;
            Password = "";
        }
    }
}

public sealed class SuperadminGameRowVm(string gameId, string name, string executablePath)
{
    public string GameId { get; } = gameId;
    public string Name { get; } = name;
    public string ExecutablePath { get; } = executablePath;
}
