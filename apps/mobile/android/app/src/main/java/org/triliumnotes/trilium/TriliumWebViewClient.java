package org.triliumnotes.trilium;

import android.net.Uri;
import android.text.TextUtils;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * WebViewClient that adds a streaming same-origin HTTP proxy for the sync worker.
 *
 * A plugin-based transport (TriliumHttp/CapacitorHttp) has to hold the entire response body
 * in Java as a string, escape it into the bridge message envelope and copy it across the
 * JS bridge — measured at ~60% of a CPU core and ~2 MB/s throughput for the duration of an
 * initial sync. Here the page instead fetch()es a same-origin URL under
 * {@code /_trilium_native_http/}, this client forwards it to the real sync server and hands
 * the response back as a raw InputStream, so the WebView's network stack streams the body
 * into the page with no full-body Java string, no envelope and no bridge copy. Being
 * same-origin from the page's point of view, no CORS applies on either leg.
 *
 * Protocol (see capacitor_http_handler.ts for the JS side):
 * <ul>
 *   <li>{@code GET /_trilium_native_http/ping} — availability probe, answers with the
 *       {@code x-trilium-native-http} marker header.</li>
 *   <li>{@code GET /_trilium_native_http/fetch?url=<encoded>} — proxies to the target URL.
 *       Only GET/HEAD: shouldInterceptRequest does not expose request bodies.</li>
 *   <li>Request headers are only forwarded when tunneled as {@code x-trilium-h-<name>} —
 *       fetch() cannot set forbidden headers such as Cookie, and this also keeps
 *       WebView-generated headers (User-Agent, sec-*, ...) off the sync connection.</li>
 *   <li>Upstream {@code Set-Cookie} is re-exposed as {@code x-trilium-set-cookie}, since
 *       fetch() cannot read it and the WebView's cookie store must not adopt sync-server
 *       session cookies for the app origin.</li>
 *   <li>Failures inside the proxy itself answer 502 with {@code x-trilium-proxy-error}.</li>
 * </ul>
 */
public class TriliumWebViewClient extends BridgeWebViewClient {

    private static final String TAG = "TriliumHttpProxy";
    private static final String INTERCEPT_PREFIX = "/_trilium_native_http/";
    private static final String HEADER_TUNNEL_PREFIX = "x-trilium-h-";
    private static final String MARKER_HEADER = "x-trilium-native-http";

    private static final int CONNECT_TIMEOUT_MS = 30_000;
    // The JS side enforces its own (configurable) sync timeout; this is only a backstop so a
    // dead connection cannot pin a WebView IO thread forever.
    private static final int READ_TIMEOUT_MS = 600_000;

    public TriliumWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (path == null || !path.startsWith(INTERCEPT_PREFIX)) {
            return super.shouldInterceptRequest(view, request);
        }

        String action = path.substring(INTERCEPT_PREFIX.length());
        if ("ping".equals(action)) {
            return syntheticResponse(200, "OK", "pong", null);
        }
        if (!"fetch".equals(action)) {
            return errorResponse("Unknown proxy action: " + action);
        }

        try {
            return proxyRequest(request, uri);
        } catch (Exception e) {
            Log.w(TAG, "Proxy request failed: " + e);
            return errorResponse(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private WebResourceResponse proxyRequest(WebResourceRequest request, Uri uri) throws IOException {
        String target = uri.getQueryParameter("url");
        if (target == null || target.isEmpty()) {
            return errorResponse("Missing url query parameter");
        }
        String method = request.getMethod() == null ? "GET" : request.getMethod().toUpperCase(Locale.ROOT);
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return errorResponse("Only GET/HEAD can be proxied, got " + method);
        }

        final HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        boolean handedOff = false;
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);

            for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
                String name = entry.getKey();
                if (name != null && name.toLowerCase(Locale.ROOT).startsWith(HEADER_TUNNEL_PREFIX)) {
                    connection.setRequestProperty(name.substring(HEADER_TUNNEL_PREFIX.length()), entry.getValue());
                }
            }
            // No explicit Accept-Encoding: Android's HttpURLConnection then negotiates gzip
            // itself and transparently inflates the stream, dropping Content-Encoding and
            // Content-Length from the header fields it reports.

            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                // WebResourceResponse rejects 3xx status codes. Same-protocol redirects were
                // already followed by the connection, so this should not happen in practice.
                return errorResponse("Upstream replied with unfollowed redirect " + status
                        + " to " + connection.getHeaderField("Location"));
            }
            String reason = connection.getResponseMessage();
            if (reason == null || reason.isEmpty()) {
                // HTTP/2 has no reason phrase, but WebResourceResponse requires a non-empty one.
                reason = "Status " + status;
            }

            Map<String, String> responseHeaders = new HashMap<>();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                String name = entry.getKey();
                if (name == null) {
                    continue; // the status line arrives as a header with a null key
                }
                String value = TextUtils.join(", ", entry.getValue());
                switch (name.toLowerCase(Locale.ROOT)) {
                    case "set-cookie":
                        responseHeaders.put("x-trilium-set-cookie", value);
                        break;
                    case "content-encoding":
                    case "transfer-encoding":
                    case "content-length":
                        // The stream handed to the WebView is already decoded, so these
                        // no longer describe it.
                        break;
                    default:
                        responseHeaders.put(name, value);
                }
            }

            String mimeType = "application/octet-stream";
            String encoding = "utf-8";
            String contentType = connection.getContentType();
            if (contentType != null) {
                String[] parts = contentType.split(";");
                mimeType = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String part = parts[i].trim();
                    if (part.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                        encoding = part.substring("charset=".length()).trim();
                    }
                }
            }

            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) {
                stream = new ByteArrayInputStream(new byte[0]);
            }
            // The WebView reads and closes the stream on its own IO threads, well after this
            // method returns — tie the connection's lifetime to the stream's.
            InputStream disconnectingStream = new FilterInputStream(stream) {
                @Override
                public void close() throws IOException {
                    try {
                        super.close();
                    } finally {
                        connection.disconnect();
                    }
                }
            };
            handedOff = true;
            return new WebResourceResponse(mimeType, encoding, status, reason, responseHeaders, disconnectingStream);
        } finally {
            if (!handedOff) {
                connection.disconnect();
            }
        }
    }

    /** A response produced by the proxy itself rather than by the upstream server. */
    private static WebResourceResponse syntheticResponse(int status, String reason, String body, String errorMessage) {
        Map<String, String> headers = new HashMap<>();
        headers.put(MARKER_HEADER, "1");
        if (errorMessage != null) {
            headers.put("x-trilium-proxy-error", sanitizeHeaderValue(errorMessage));
        }
        return new WebResourceResponse("text/plain", "utf-8", status, reason,
                headers, new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static WebResourceResponse errorResponse(String message) {
        return syntheticResponse(502, "Proxy Error", message, message);
    }

    /** Exception messages can contain characters that are not valid in a header value. */
    private static String sanitizeHeaderValue(String value) {
        return value.replaceAll("[^\\x20-\\x7e]", " ");
    }
}
