package org.triliumnotes.trilium;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Binary file-write channel for the page's downloads and backups.
 *
 * <p>The Capacitor plugin bridge carries binary as base64 inside a JSON string, and the native
 * side re-parses that whole string per call ({@code MessageHandler} → {@code org.json}), which
 * is far too slow for large files. This listener receives raw {@code ArrayBuffer} messages
 * instead — no base64, no JSON around the payload — and appends them to a file on an IO thread.
 *
 * <p>Protocol, driven by {@code capacitor_download.ts}: a JSON string {@code {"type":"open",
 * "path":…}} (answered {@code opened}), then any number of ArrayBuffer chunks (each answered
 * {@code written}), then {@code {"type":"close"}} (answered {@code closed}). Any failure answers
 * {@code error:<detail>} and closes the file. The page sends nothing further until each answer
 * arrives, so one open file is all the state there is.
 *
 * <p>The path arrives absolute, resolved by the page through the Filesystem plugin's own
 * directory mapping. That grants the page no authority it does not already have: the Filesystem
 * plugin writes wherever the page asks, too.
 */
public final class TriliumFileSink {

    private static final String TAG = "TriliumFileSink";
    private static final String JS_OBJECT_NAME = "triliumFileSink";

    /** One thread, so writes land in the order the page sent them. */
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    /** Replies must be posted from the UI thread, which the IO thread is not. */
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private OutputStream out;

    private TriliumFileSink() {}

    /**
     * Registers the listener on the bridge's WebView, injecting {@code window.triliumFileSink}
     * into pages of the app origin. When the WebView cannot carry ArrayBuffer messages the object
     * is never injected, and the page falls back to the plugin bridge on its own.
     */
    public static void install(Bridge bridge) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) {
            Log.i(TAG, "WebMessage ArrayBuffers are unavailable; file writes stay on the plugin bridge");
            return;
        }

        TriliumFileSink sink = new TriliumFileSink();
        WebViewCompat.addWebMessageListener(
            bridge.getWebView(),
            JS_OBJECT_NAME,
            bridge.getAllowedOriginRules(),
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (isMainFrame) {
                    sink.onMessage(message, replyProxy);
                }
            }
        );
    }

    private void onMessage(WebMessageCompat message, JavaScriptReplyProxy reply) {
        if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            byte[] chunk = message.getArrayBuffer();
            io.execute(() -> writeChunk(chunk, reply));
        } else {
            String command = message.getData();
            io.execute(() -> runCommand(command, reply));
        }
    }

    private void writeChunk(byte[] chunk, JavaScriptReplyProxy reply) {
        try {
            if (out == null) {
                throw new IOException("No file is open");
            }
            out.write(chunk);
            answer(reply, "written");
        } catch (Exception e) {
            fail(reply, e);
        }
    }

    private void runCommand(String command, JavaScriptReplyProxy reply) {
        try {
            JSONObject parsed = new JSONObject(command);
            String type = parsed.getString("type");

            if ("open".equals(type)) {
                // A leftover stream means the previous transfer died without a close; its file is
                // already accounted a failure on the page, so the new transfer simply wins.
                closeQuietly();
                File file = new File(parsed.getString("path"));
                File parent = file.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    throw new IOException("Cannot create " + parent);
                }
                out = new BufferedOutputStream(new FileOutputStream(file));
                answer(reply, "opened");
            } else if ("close".equals(type)) {
                if (out != null) {
                    out.close();
                    out = null;
                }
                answer(reply, "closed");
            } else {
                throw new IOException("Unknown command: " + type);
            }
        } catch (Exception e) {
            fail(reply, e);
        }
    }

    private void fail(JavaScriptReplyProxy reply, Exception e) {
        Log.w(TAG, "File sink failed", e);
        closeQuietly();
        answer(reply, "error:" + e.getMessage());
    }

    private void closeQuietly() {
        if (out != null) {
            try {
                out.close();
            } catch (IOException ignored) {
                // The caller is already on an error path, or replacing the stream.
            }
            out = null;
        }
    }

    private void answer(JavaScriptReplyProxy reply, String message) {
        mainHandler.post(() -> reply.postMessage(message));
    }
}
