package nl.rarevogel.cubic;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Cubic: the player is one HTML page in the assets, served as https://cubic.local/ so that IndexedDB,
 * AudioWorklet and blob URLs work. Two extra routes on that origin:
 *   /__doc?u=content://...   streams a file from a folder the user picked (persisted permission)
 *   /__proxy?u=https://...   fetches a web page or file natively, so online browsing has no CORS limit
 * Playback continues in the background through PlaybackService (media notification, headset buttons).
 */
public class MainActivity extends Activity {
    static final String HOST = "https://cubic.local/";
    private static final int PICK_FILES = 1, PICK_FOLDER = 2;
    static MainActivity current;
    WebView web;
    private ValueCallback<Uri[]> filesCallback;
    private boolean askedNotify;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        web = new WebView(this);
        web.setBackgroundColor(0xff05070d);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "CubicAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (!url.startsWith(HOST)) return null;
                Uri u = req.getUrl();
                String path = u.getPath();
                try {
                    if ("/__doc".equals(path)) return document(u.getQueryParameter("u"));
                    if ("/__proxy".equals(path)) return proxy(u.getQueryParameter("u"));
                    if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
                    InputStream in = getAssets().open(path.substring(1));
                    return new WebResourceResponse(path.endsWith(".html") ? "text/html" : "application/octet-stream", "UTF-8", in);
                } catch (Exception e) {
                    WebResourceResponse r = new WebResourceResponse("text/plain", "UTF-8", null);
                    r.setStatusCodeAndReasonPhrase(404, "Not found");
                    return r;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.startsWith(HOST)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception e) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (filesCallback != null) filesCallback.onReceiveValue(null);
                filesCallback = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(i, PICK_FILES);
                } catch (Exception e) {
                    filesCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Android 15 draws behind the system bars. A WebView does not move its page for its own padding,
        // so it sits in a frame that is padded by the status bar, navigation bar and display cutout.
        final android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
        frame.setBackgroundColor(0xff05070d);
        frame.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        frame.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            @SuppressWarnings("deprecation")
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                int l = in.getSystemWindowInsetLeft(), t = in.getSystemWindowInsetTop(), r = in.getSystemWindowInsetRight(), b = in.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && in.getDisplayCutout() != null) {
                    android.view.DisplayCutout c = in.getDisplayCutout();
                    l = Math.max(l, c.getSafeInsetLeft()); t = Math.max(t, c.getSafeInsetTop());
                    r = Math.max(r, c.getSafeInsetRight()); b = Math.max(b, c.getSafeInsetBottom());
                }
                v.setPadding(l, t, r, b);
                return in;
            }
        });
        setContentView(frame);
        frame.requestApplyInsets();
        web.loadUrl(HOST + "index.html");
    }

    private WebResourceResponse document(String uri) throws Exception {
        Uri u = Uri.parse(uri);
        InputStream in = getContentResolver().openInputStream(u);
        WebResourceResponse r = new WebResourceResponse("application/octet-stream", null, in);
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        r.setResponseHeaders(h);
        return r;
    }

    private WebResourceResponse proxy(String target) throws Exception {
        URL url = new URL(target);
        String proto = url.getProtocol();
        if (!"http".equals(proto) && !"https".equals(proto)) throw new Exception("bad url");
        HttpURLConnection c = null;
        for (int hop = 0; hop < 6; hop++) {
            c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "CubicPlayer/1.0 (Android)");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(url, c.getHeaderField("Location"));
                c.disconnect();
                continue;
            }
            break;
        }
        int code = c.getResponseCode();
        String type = c.getContentType();
        String mime = type == null ? "application/octet-stream" : type.split(";")[0].trim();
        String charset = null;
        if (type != null && type.toLowerCase().contains("charset=")) charset = type.substring(type.toLowerCase().indexOf("charset=") + 8).trim();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        WebResourceResponse r = new WebResourceResponse(mime, charset, in);
        r.setStatusCodeAndReasonPhrase(code, code >= 400 ? "Error" : "OK");
        Map<String, String> h = new HashMap<>();
        h.put("Content-Type", type == null ? mime : type);
        r.setResponseHeaders(h);
        return r;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == PICK_FILES) {
            Uri[] r = null;
            if (result == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    r = new Uri[clip.getItemCount()];
                    for (int i = 0; i < r.length; i++) r[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) r = new Uri[] { data.getData() };
            }
            if (filesCallback != null) filesCallback.onReceiveValue(r);
            filesCallback = null;
        } else if (code == PICK_FOLDER && result == RESULT_OK && data != null && data.getData() != null) {
            final Uri tree = data.getData();
            try { getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception e) { }
            new Thread(new Runnable() {
                public void run() {
                    final JSONArray out = new JSONArray();
                    try {
                        String rootId = DocumentsContract.getTreeDocumentId(tree);
                        String rootName = rootId.contains(":") ? rootId.substring(rootId.lastIndexOf(':') + 1) : rootId;
                        if (rootName.isEmpty()) rootName = "Folder";
                        if (rootName.contains("/")) rootName = rootName.substring(rootName.lastIndexOf('/') + 1);
                        walk(tree, rootId, rootName, out, 0);
                    } catch (Exception e) { }
                    runOnUiThread(new Runnable() {
                        public void run() {
                            web.evaluateJavascript("window.__androidFolder && __androidFolder(" + JSONObject.quote(out.toString()) + ")", null);
                        }
                    });
                }
            }).start();
        }
    }

    private void walk(Uri tree, String docId, String path, JSONArray out, int depth) throws Exception {
        if (depth > 12 || out.length() > 30000) return;
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        Cursor c = getContentResolver().query(kids, new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE }, null, null, null);
        if (c == null) return;
        try {
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                long size = c.isNull(3) ? 0 : c.getLong(3);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) walk(tree, id, path + "/" + name, out, depth + 1);
                else {
                    JSONObject o = new JSONObject();
                    o.put("path", path + "/" + name);
                    o.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    o.put("size", size);
                    out.put(o);
                }
            }
        } finally { c.close(); }
    }

    void media(String action) {
        if (web != null) web.evaluateJavascript("window.__androidMedia && __androidMedia('" + action + "')", null);
    }

    class Bridge {
        @JavascriptInterface
        public void pickFolder() {
            runOnUiThread(new Runnable() {
                public void run() {
                    try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), PICK_FOLDER); } catch (Exception e) { }
                }
            });
        }

        @JavascriptInterface
        public void setPlaying(final boolean playing, final String title, final String artist) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (playing && Build.VERSION.SDK_INT >= 33 && !askedNotify
                            && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        askedNotify = true;
                        requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 7);
                    }
                    PlaybackService.update(MainActivity.this, playing, title, artist);
                }
            });
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.__terug ? String(__terug()) : 'false'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v == null || !v.contains("true")) moveTaskToBack(true);   // keep playing in the background
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        PlaybackService.stop(this);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
