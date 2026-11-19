// Font Manage Windows shell — WebView2 host mirroring native/Workspace.swift:
// single instance, window placement persistence, close-save handshake with the page.
using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    private const string MutexName = "FontManage.Workspace.SingleInstance";
    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Font Manage");
    private static readonly string StateFile = Path.Combine(DataDir, "window-win.json");
    private static Mutex _mutex;

    [STAThread]
    private static int Main(string[] args)
    {
        _mutex = new Mutex(true, MutexName, out bool createdNew);
        if (!createdNew) return 0; // existing instance owns the workspace
        if (args.Length == 0 || !Uri.TryCreate(args[0], UriKind.Absolute, out var url))
        {
            MessageBox.Show("Usage: font-workspace <workspace-url>", "Font Manage", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
        ApplicationConfiguration.Initialize();
        var form = new Form
        {
            Text = "Font Manage",
            Width = 560,
            Height = 840,
            MinimumSize = new Size(400, 540),
            StartPosition = FormStartPosition.CenterScreen
        };
        var webView = new WebView2 { Dock = DockStyle.Fill };
        form.Controls.Add(webView);

        RestorePlacement(form);

        form.FormClosing += async (_, _) =>
        {
            SavePlacement(form);
            try
            {
                if (webView.CoreWebView2 != null)
                {
                    var done = new TaskCompletionSource<bool>();
                    webView.WebMessageReceived += (_, e) =>
                    {
                        if (e.WebMessageAsJson.Contains("\"close-ready\"")) done.TrySetResult(true);
                    };
                    await webView.CoreWebView2.ExecuteScriptAsync("window.fontManageClose && window.fontManageClose()");
                    await Task.WhenAny(done.Task, Task.Delay(1500));
                }
            }
            catch { /* closing anyway */ }
        };

        form.Load += async (_, _) =>
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "webview2"));
            await webView.EnsureCoreWebView2Async(env);
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.chrome && window.chrome.webview && (window.webkit = { messageHandlers: { close: { postMessage: function(){ window.chrome.webview.postMessage('close-ready'); window.close(); } } } });");
            webView.CoreWebView2.Navigate(url.ToString());
        };

        Application.Run(form);
        _mutex.ReleaseMutex();
        return 0;
    }

    private static void RestorePlacement(Form form)
    {
        try
        {
            if (!File.Exists(StateFile)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(StateFile));
            var r = doc.RootElement;
            int x = r.GetProperty("x").GetInt32(), y = r.GetProperty("y").GetInt32();
            int w = r.GetProperty("width").GetInt32(), h = r.GetProperty("height").GetInt32();
            if (w >= 400 && h >= 540 && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(x, y, 40, 40))))
            {
                form.StartPosition = FormStartPosition.Manual;
                form.Bounds = new Rectangle(x, y, w, h);
            }
        }
        catch { /* default placement */ }
    }

    private static void SavePlacement(Form form)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            var bounds = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            File.WriteAllText(StateFile, JsonSerializer.Serialize(new { x = bounds.X, y = bounds.Y, width = bounds.Width, height = bounds.Height }));
        }
        catch { /* best effort */ }
    }
}
