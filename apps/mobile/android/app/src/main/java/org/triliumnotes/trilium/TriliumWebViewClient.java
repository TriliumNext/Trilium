package org.triliumnotes.trilium;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * WebViewClient that answers two kinds of request before Capacitor's asset server sees them:
 * local API requests, through {@link TriliumRequestBridge}, and the sync worker's streaming
 * HTTP proxy under {@code /_trilium_native_http/}, through {@link NativeHttpProxy}.
 */
public class TriliumWebViewClient extends BridgeWebViewClient {

    private static final String TAG = "TriliumHttpProxy";

    private static final int CONNECT_TIMEOUT_MS = 30_000;
    // The JS side enforces its own (configurable) sync timeout; this is only a backstop so a
    // dead connection cannot pin a WebView IO thread forever.
    private static final int READ_TIMEOUT_MS = 600_000;

    /** Null when the WebView cannot host it; the page then uses its service worker. */
    private final TriliumRequestBridge requestBridge;

    private final NativeHttpProxy proxy =
        new NativeHttpProxy(message -> Log.w(TAG, message), CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);

    public TriliumWebViewClient(Bridge bridge, TriliumRequestBridge requestBridge) {
        super(bridge);
        this.requestBridge = requestBridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (requestBridge != null && requestBridge.handles(uri)) {
            return toWebResourceResponse(requestBridge.handle(request));
        }

        String path = uri.getPath();
        if (!NativeHttpProxy.isProxyPath(path)) {
            return super.shouldInterceptRequest(view, request);
        }
        return toWebResourceResponse(proxy.handle(
            path, request.getMethod(), uri.getQueryParameter("url"), request.getRequestHeaders()));
    }

    private static WebResourceResponse toWebResourceResponse(InterceptedResponse response) {
        return new WebResourceResponse(response.mimeType, response.encoding, response.status,
                response.reasonPhrase, response.headers, response.body);
    }
}
