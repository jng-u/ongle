package kr.ongyeol.journal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.print.PrintManager;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline app shell with private local medication reminders; no storage permission.
 * Manifest owner: minSdk 26, targetSdk 35, compileSdk 36, usesCleartextTraffic=false,
 * allowBackup=false. Bundle built web output at assets/web/. No exported deep links.
 */
public final class MainActivity extends Activity {
    private static final int RESTORE = 10, EXPORT = 11;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebView web;
    private WebMessagePort nativePort;
    private int generation;
    private int installedGeneration = -1;
    private ValueCallback<Uri[]> chooser;
    private CancellationSignal restoreRead;
    private ByteArrayOutputStream incoming;
    private int expectedBytes;
    private String exportName, exportMime;
    private byte[] pendingExport;
    private boolean exportPicker;
    private WebMessagePort exportPort;
    private long exportReply;
    private WebMessagePort permissionPort;
    private long permissionReply;
    private static final int NOTIFICATIONS = 12;

    @SuppressWarnings("deprecation") // API 26 insets compatibility.
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xfff7f8f4);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Padding the native container keeps CSS fixed navigation above system bars/IME.
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        root.requestApplyInsets();
        MedicationAlarms.channel(this);
        configureWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        web.loadUrl(ShellPolicy.ORIGIN + "/");
    }

    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(true); // Reject popup WebViews via onCreateWindow.
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSaveFormData(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setSafeBrowsingEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        // The shell serves assets itself. Do not let a web SW bypass that boundary.
        ServiceWorkerController sw = ServiceWorkerController.getInstance();
        sw.getServiceWorkerWebSettings().setAllowContentAccess(false);
        sw.getServiceWorkerWebSettings().setAllowFileAccess(false);
        sw.getServiceWorkerWebSettings().setBlockNetworkLoads(true);
        sw.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return error(403, "Forbidden");
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return intercept(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!request.isForMainFrame()) return true;
                if ("GET".equals(request.getMethod()) && ShellPolicy.trusted(url)
                        && !"/android-source".equals(request.getUrl().getPath())) return false;
                if (request.hasGesture() && "GET".equals(request.getMethod())
                        && ShellPolicy.externalHttps(url)) openExternal(url);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                generation++;
                closePort();
                incoming = null;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (ShellPolicy.trusted(url) && url.equals(view.getUrl())) installHooks();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture,
                    android.os.Message message) {
                // target=_blank links go to browser; no secondary renderer ever gets a port.
                WebView.HitTestResult hit = view.getHitTestResult();
                if (gesture && hit != null && ShellPolicy.externalHttps(hit.getExtra())) openExternal(hit.getExtra());
                return false;
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = null;
                if (!ShellPolicy.trusted(view.getUrl()) || params.getMode() != FileChooserParams.MODE_OPEN
                        || params.isCaptureEnabled()) { callback.onReceiveValue(null); return true; }
                chooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, RESTORE); }
                catch (ActivityNotFoundException e) { finishChooser(null); toast("파일 선택기를 열 수 없어요."); }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, size) -> toast("앱의 파일 저장 버튼을 이용해 주세요."));
    }

    private WebResourceResponse intercept(WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (!"GET".equals(request.getMethod())) return error(405, "Method Not Allowed");
        if (ShellPolicy.trusted(url)) {
            String path = request.getUrl().getPath();
            if ("/android-source".equals(path)) {
                // A text-only same-origin fetch, never a document/iframe or executable script.
                if (request.isForMainFrame()) return error(403, "Forbidden");
                String fixed = ShellPolicy.mayoUrl(request.getUrl().getEncodedQuery());
                if (fixed == null) return error(400, "Bad Request");
                return remote(fixed, true);
            }
            if ("/sw.js".equals(path)) return error(404, "Not Found");
            String asset = ShellPolicy.assetPath(url);
            if (asset == null) return error(404, "Not Found");
            try { return response(200, "OK", mime(asset), getAssets().open(asset)); }
            catch (IOException e) { return error(404, "Not Found"); }
        }
        if (!request.isForMainFrame() && ShellPolicy.rxNorm(url)) return remote(url, false);
        // Always return a response: null would allow WebView to reach the network.
        return error(403, "Forbidden");
    }

    private WebResourceResponse remote(String fixedUrl, boolean mayo) {
        HttpURLConnection connection = null;
        try {
            long deadline = SystemClock.elapsedRealtime() + 8000;
            connection = (HttpURLConnection) new URL(fixedUrl).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setUseCaches(false);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", mayo ? "text/html" : "application/json");
            connection.setRequestProperty("Accept-Language", "en");
            connection.setRequestProperty("Accept-Encoding", "identity");
            // No WebView headers, cookies, referrer, request body or patient data forwarded.
            if (connection.getResponseCode() != 200) throw new IOException("HTTP failure");
            String type = connection.getContentType();
            String expected = mayo ? "text/html" : "application/json";
            if (type == null || !type.toLowerCase(Locale.ROOT).split(";", 2)[0].trim().equals(expected)
                    || connection.getContentLengthLong() > ShellPolicy.MAX_REFERENCE) throw new IOException("Invalid response");
            byte[] bytes;
            try (InputStream stream = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                while (true) {
                    long remaining = deadline - SystemClock.elapsedRealtime();
                    if (remaining <= 0) throw new IOException("Timeout");
                    connection.setReadTimeout((int) Math.min(4000, remaining));
                    int count = stream.read(buffer);
                    if (count == -1) break;
                    if (out.size() + count > ShellPolicy.MAX_REFERENCE) throw new IOException("Too large");
                    out.write(buffer, 0, count);
                }
                bytes = out.toByteArray();
            }
            if (bytes.length == 0) throw new IOException("Empty response");
            WebResourceResponse result = response(200, "OK", expected,
                    new ByteArrayInputStream(bytes));
            Map<String, String> headers = new HashMap<>(result.getResponseHeaders());
            if (mayo) {
                headers.put("X-Resolved-Url", fixedUrl);
                // The raw HTML is for DOMParser only, never active local-origin content.
                headers.put("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
            }
            else headers.put("Access-Control-Allow-Origin", ShellPolicy.ORIGIN);
            result.setResponseHeaders(headers);
            return result;
        } catch (IOException | RuntimeException e) { return error(503, "Service Unavailable"); }
        finally { if (connection != null) connection.disconnect(); }
    }

    private static WebResourceResponse response(int code, String reason, String mime, InputStream stream) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", ShellPolicy.CSP);
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Cache-Control", "no-store");
        headers.put("Referrer-Policy", "no-referrer");
        headers.put("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        return new WebResourceResponse(mime, "UTF-8", code, reason, headers, stream);
    }

    private static WebResourceResponse error(int code, String reason) {
        return response(code, reason, "text/plain", new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private void installHooks() {
        if (installedGeneration == generation) return;
        installedGeneration = generation;
        closePort();
        final int document = generation;
        WebMessagePort[] ports = web.createWebMessageChannel();
        nativePort = ports[0];
        nativePort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort port, WebMessage message) {
                if (document != generation || port != nativePort || !ShellPolicy.trusted(web.getUrl())) return;
                long id = -1;
                boolean alarm = false;
                try {
                    String data = message.getData();
                    if (data == null || data.length() > 2097152) throw new IOException("Message size");
                    JSONObject request = new JSONObject(data);
                    id = request.getLong("requestId");
                    String op = request.getString("op");
                    alarm = op.startsWith("alarms.");
                    if (alarm) handleAlarmMessage(port, id, op, request);
                    else {
                        boolean saving = "save".equals(op);
                        if (saving) {
                            if (exportPort != null) throw new IOException("Save in progress");
                            exportPort = port; exportReply = id;
                        }
                        try { handleMessage(data); }
                        catch (Exception e) { if (saving) exportPort = null; throw e; }
                        if (!saving) reply(port, id, true, null);
                    }
                } catch (Exception e) {
                    if (!alarm) incoming = null;
                    reply(port, id, false, null);
                }
            }
        });
        // postWebMessage has no web sender origin. Authenticate the one-time transfer
        // with a private random token, exact target origin and a native (null) source.
        final String token = "ongle-native-port:" + UUID.randomUUID();
        web.evaluateJavascript(ShellScript.INSTALL.replace("__PORT_TOKEN__", token), ignored -> {
            if (document == generation && ShellPolicy.trusted(web.getUrl()) && nativePort == ports[0]) {
                web.postWebMessage(new WebMessage(token, new WebMessagePort[]{ports[1]}),
                        Uri.parse(ShellPolicy.ORIGIN));
            } else ports[1].close();
        });
    }

    private void reply(WebMessagePort port, long id, boolean ok, JSONObject value) {
        if (port == null || port != nativePort) return;
        try {
            JSONObject result = new JSONObject().put("requestId", id).put("ok", ok);
            if (value != null) result.put("value", value);
            port.postMessage(new WebMessage(result.toString()));
        } catch (RuntimeException | org.json.JSONException ignored) { }
    }

    private void handleAlarmMessage(WebMessagePort port, long id, String op, JSONObject request) throws Exception {
        switch (op) {
            case "alarms.status": break;
            case "alarms.sync": MedicationAlarms.sync(this, request.getJSONObject("payload")); break;
            case "alarms.requestPermission":
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    if (permissionPort != null) throw new IOException("Permission request pending");
                    permissionPort = port; permissionReply = id;
                    try { requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS); }
                    catch (RuntimeException e) { permissionPort = null; throw e; }
                    return;
                }
                if (!MedicationAlarms.notifications(this)) {
                    startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName()));
                }
                break;
            case "alarms.requestExact":
                if (Build.VERSION.SDK_INT >= 31 && !MedicationAlarms.exact(this)) {
                    startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:" + getPackageName())));
                }
                break;
            default: throw new IOException("Unknown alarm operation");
        }
        reply(port, id, true, MedicationAlarms.status(this));
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFICATIONS) {
            WebMessagePort port = permissionPort;
            permissionPort = null;
            MedicationAlarms.reschedule(this);
            if (port != null) {
                try { reply(port, permissionReply, true, MedicationAlarms.status(this)); }
                catch (org.json.JSONException e) { reply(port, permissionReply, false, null); }
            }
        }
    }

    @Override protected void onResume() {
        super.onResume();
        MedicationAlarms.reschedule(this);
        if (web != null && ShellPolicy.trusted(web.getUrl())) web.evaluateJavascript(
                "window.dispatchEvent(new Event('ongyeol-alarms-resume'))", null);
    }

    private void handleMessage(String data) throws Exception {
        if (data == null || data.length() > 50000) throw new IOException("Message size");
        JSONObject message = new JSONObject(data);
        switch (message.getString("op")) {
            case "print":
                PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                if (manager == null) throw new IOException("No print service");
                manager.print("온결 진료 요약", web.createPrintDocumentAdapter("온결 진료 요약"), null);
                break;
            case "begin":
                if (exportPicker || pendingExport != null || incoming != null) throw new IOException("Save in progress");
                String name = message.getString("name"), mime = message.getString("mime");
                int size = message.getInt("size");
                if (!allowedExport(name, mime) || size <= 0 || size > ShellPolicy.MAX_EXPORT) throw new IOException("Invalid file");
                exportName = name;
                exportMime = mime;
                expectedBytes = size;
                incoming = new ByteArrayOutputStream();
                break;
            case "chunk":
                if (incoming == null) throw new IOException("No transfer");
                byte[] chunk = Base64.decode(message.getString("data"), Base64.NO_WRAP);
                if (chunk.length > 32768 || incoming.size() + chunk.length > expectedBytes) throw new IOException("Invalid chunk");
                incoming.write(chunk);
                break;
            case "save":
                if (incoming == null || incoming.size() != expectedBytes || exportPicker) throw new IOException("Incomplete file");
                byte[] bytes = incoming.toByteArray();
                incoming = null;
                validateExport(bytes);
                pendingExport = bytes;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(exportMime).putExtra(Intent.EXTRA_TITLE, exportName)
                        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try { startActivityForResult(intent, EXPORT); exportPicker = true; }
                catch (RuntimeException e) { pendingExport = null; throw e; }
                break;
            default: throw new IOException("Unknown operation");
        }
    }

    static boolean allowedExport(String name, String mime) {
        return (name.matches("ongle-backup-\\d{4}-\\d{2}-\\d{2}\\.json") && mime.equals("application/json"))
                || (name.matches("ongle-reminders-\\d{4}-\\d{2}-\\d{2}\\.ics") && mime.equals("text/calendar"));
    }

    private void validateExport(byte[] bytes) throws Exception {
        String text = new String(bytes, StandardCharsets.UTF_8);
        if ("application/json".equals(exportMime)) {
            // Export only the web app's encrypted envelope, never raw journal JSON.
            JSONObject json = new JSONObject(text);
            if (json.length() != 8 || !"ongle-encrypted-backup".equals(json.optString("format"))
                    || json.optInt("version") != 1 || !"PBKDF2-SHA256".equals(json.optString("kdf"))
                    || json.optInt("iterations") != 310000 || !"AES-256-GCM".equals(json.optString("cipher"))
                    || Base64.decode(json.getString("salt"), Base64.NO_WRAP).length != 16
                    || Base64.decode(json.getString("iv"), Base64.NO_WRAP).length != 12
                    || Base64.decode(json.getString("ciphertext"), Base64.NO_WRAP).length < 16) {
                throw new IOException("Not encrypted backup");
            }
        } else if (!text.startsWith("BEGIN:VCALENDAR\r\n") || !text.contains("END:VCALENDAR")) {
            throw new IOException("Invalid calendar");
        }
    }

    @SuppressWarnings("try") // Cancellation must close a blocked provider read before scope exit.
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (uri != null && !"content".equals(uri.getScheme())) uri = null;
        if (request == RESTORE) {
            if (uri == null) { finishChooser(null); return; }
            final Uri selected = uri;
            final int document = generation;
            final ValueCallback<Uri[]> callback = chooser;
            chooser = null;
            // Preflight the selected file with a bounded read. The React importer also
            // checks File.size and validates/decrypts the envelope before any restore.
            if (restoreRead != null) restoreRead.cancel();
            restoreRead = new CancellationSignal();
            final CancellationSignal cancel = restoreRead;
            main.postDelayed(cancel::cancel, 10000);
            io.execute(() -> {
                byte[] bytes = null;
                try (android.os.ParcelFileDescriptor descriptor = getContentResolver().openFileDescriptor(selected, "r", cancel)) {
                    if (descriptor == null) throw new IOException("No file");
                    cancel.setOnCancelListener(() -> { try { descriptor.close(); } catch (IOException ignored) { } });
                    try (InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            cancel.throwIfCanceled();
                            if (out.size() + count > ShellPolicy.MAX_EXPORT) throw new IOException("Too large");
                            out.write(buffer, 0, count);
                        }
                        if (out.size() == 0) throw new IOException("Empty file");
                        bytes = out.toByteArray();
                    }
                } catch (Exception e) { /* Report generically without logging patient content. */ }
                finally { cancel.setOnCancelListener(null); }
                final byte[] restored = bytes;
                main.post(() -> {
                    if (callback == null) return;
                    if (restored == null || document != generation || isDestroyed()) {
                        callback.onReceiveValue(null); toast("백업 파일을 열 수 없어요 (최대 8MB).");
                    } else {
                        // SAF content URI must be passed to WebView's chooser machinery;
                        // that grants only the selected file, without enabling general content access.
                        callback.onReceiveValue(new Uri[]{selected});
                    }
                });
            });
        } else if (request == EXPORT) {
            final byte[] bytes = pendingExport;
            pendingExport = null;
            final WebMessagePort port = exportPort;
            final long requestId = exportReply;
            if (uri == null || bytes == null) {
                exportPicker = false; exportPort = null;
                exportResult(port, requestId, result == RESULT_CANCELED ? "cancelled" : "failed");
                return;
            }
            final Uri destination = uri;
            io.execute(() -> {
                try {
                    writeExport(getContentResolver().openOutputStream(destination, "wt"), bytes);
                } catch (IOException | RuntimeException e) {
                    main.post(() -> {
                        exportPicker = false; exportPort = null;
                        exportResult(port, requestId, "failed");
                    });
                    return;
                }
                // Reached only after try-with-resources closes successfully.
                main.post(() -> {
                    exportPicker = false; exportPort = null;
                    exportResult(port, requestId, "saved");
                });
            });
        }
    }

    static void writeExport(OutputStream stream, byte[] bytes) throws IOException {
        try (OutputStream destination = stream) {
            if (destination == null) throw new IOException("No destination");
            destination.write(bytes);
            destination.flush();
        }
    }

    private void exportResult(WebMessagePort port, long id, String status) {
        try { reply(port, id, true, new JSONObject().put("status", status)); }
        catch (org.json.JSONException ignored) { }
    }

    private void finishChooser(Uri[] value) {
        if (chooser != null) { chooser.onReceiveValue(value); chooser = null; }
    }

    private void closePort() { if (nativePort != null) { nativePort.close(); nativePort = null; } }
    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) { toast("링크를 열 브라우저가 없어요."); }
    }
    private void toast(String text) { if (!isDestroyed()) Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    @SuppressWarnings("deprecation") // target 35 retains legacy Back unless manifest opts in.
    @Override public void onBackPressed() { handleBack(); }
    private void handleBack() { if (web.canGoBack()) web.goBack(); else finish(); }
    @Override protected void onDestroy() {
        generation++;
        closePort();
        finishChooser(null);
        if (restoreRead != null) restoreRead.cancel();
        main.removeCallbacksAndMessages(null);
        incoming = null;
        pendingExport = null;
        web.stopLoading();
        web.destroy();
        io.shutdownNow();
        super.onDestroy();
    }
}
