package org.triliumnotes.trilium;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;

/**
 * Answers the page's local API requests ({@code /api/}, {@code /bootstrap}, …) from the in-page
 * SQLite worker, in place of a service worker.
 *
 * <p>Connects {@link LocalRequestBroker}, which holds the request logic, to the WebView: the
 * {@code window.triliumRequestBridge} message listener carries the page's replies,
 * {@code evaluateJavascript} delivers requests, and Capacitor's {@code onPageStarted} resets the
 * broker when the page reloads.
 */
public final class TriliumRequestBridge {

    private static final String TAG = "TriliumRequestBridge";
    private static final String JS_OBJECT_NAME = "triliumRequestBridge";

    /**
     * Matches the service worker's limit in {@code sw.ts}: the worker can be inside a long
     * synchronous stretch (a VACUUM of a large database) before it answers.
     */
    private static final long HEAD_TIMEOUT_MS = 270_000;

    private final Bridge bridge;
    private final LocalRequestBroker broker;

    private TriliumRequestBridge(Bridge bridge, boolean binaryChunks) {
        this.bridge = bridge;
        Handler mainHandler = new Handler(Looper.getMainLooper());
        this.broker = new LocalRequestBroker(
            (script, accepted) -> bridge.getWebView().evaluateJavascript(
                script, result -> accepted.accept("true".equals(result))),
            mainHandler::post,
            data -> Base64.decode(data, Base64.DEFAULT),
            message -> Log.w(TAG, message),
            HEAD_TIMEOUT_MS,
            binaryChunks);
    }

    /**
     * Injects {@code window.triliumRequestBridge} into pages of the app origin. Returns null when
     * the WebView has no message listeners; the object is then never injected, and the page
     * registers its service worker instead.
     */
    public static TriliumRequestBridge install(Bridge bridge) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.i(TAG, "WebMessage listeners are unavailable; local requests stay on the service worker");
            return null;
        }

        TriliumRequestBridge requestBridge = new TriliumRequestBridge(
            bridge, WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER));
        LocalRequestBroker broker = requestBridge.broker;
        WebViewCompat.addWebMessageListener(
            bridge.getWebView(),
            JS_OBJECT_NAME,
            bridge.getAllowedOriginRules(),
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (!isMainFrame) {
                    return;
                }
                if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
                    broker.onFrame(message.getArrayBuffer());
                } else {
                    broker.onMessage(message.getData());
                }
            }
        );
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                broker.onPageStarted();
            }
        });
        return requestBridge;
    }

    /** Whether the request is for a local API path on the app's own origin. */
    public boolean handles(Uri uri) {
        return bridge.getScheme().equals(uri.getScheme())
            && bridge.getHost().equals(uri.getHost())
            && LocalRequestBroker.isLocalPath(uri.getPath());
    }

    /** Answers a request {@link #handles} accepted. Blocks the calling WebView IO thread. */
    InterceptedResponse handle(WebResourceRequest request) {
        return broker.handle(request.getMethod(), request.getUrl().toString(), request.getRequestHeaders());
    }
}
