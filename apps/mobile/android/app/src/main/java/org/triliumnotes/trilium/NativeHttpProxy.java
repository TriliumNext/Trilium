package org.triliumnotes.trilium;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Streaming same-origin HTTP proxy for the sync worker, served by {@code TriliumWebViewClient}.
 *
 * <p>A plugin-based transport (TriliumHttp/CapacitorHttp) has to hold the entire response body
 * in Java as a string, escape it into the bridge message envelope and copy it across the
 * JS bridge — measured at ~60% of a CPU core and ~2 MB/s throughput for the duration of an
 * initial sync. Here the page instead fetch()es a same-origin URL under {@link #PREFIX}, this
 * proxy forwards it to the real sync server and hands the response back as a raw InputStream,
 * so the WebView's network stack streams the body into the page with no full-body Java string,
 * no envelope and no bridge copy. Being same-origin from the page's point of view, no CORS
 * applies on either leg.
 *
 * <p>Protocol (see capacitor_http_handler.ts for the JS side):
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
 *
 * <p>Holds no Android classes, so it runs in plain JVM unit tests.
 */
final class NativeHttpProxy {

    static final String PREFIX = "/_trilium_native_http/";
    static final String MARKER_HEADER = "x-trilium-native-http";
    static final String ERROR_HEADER = "x-trilium-proxy-error";
    private static final String HEADER_TUNNEL_PREFIX = "x-trilium-h-";

    private final Consumer<String> warn;
    private final int connectTimeoutMs;
    private final int readTimeoutMs;

    NativeHttpProxy(Consumer<String> warn, int connectTimeoutMs, int readTimeoutMs) {
        this.warn = warn;
        this.connectTimeoutMs = connectTimeoutMs;
        this.readTimeoutMs = readTimeoutMs;
    }

    static boolean isProxyPath(String path) {
        return path != null && path.startsWith(PREFIX);
    }

    /**
     * Answers a request under {@link #PREFIX}.
     *
     * @param target the {@code url} query parameter, or null when absent.
     */
    InterceptedResponse handle(String path, String method, String target, Map<String, String> requestHeaders) {
        String action = path.substring(PREFIX.length());
        if ("ping".equals(action)) {
            return synthetic(200, "OK", "pong", null);
        }
        if (!"fetch".equals(action)) {
            return error("Unknown proxy action: " + action);
        }

        try {
            return proxy(method, target, requestHeaders);
        } catch (Exception e) {
            return error(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private InterceptedResponse proxy(String method, String target, Map<String, String> requestHeaders)
            throws IOException {
        if (target == null || target.isEmpty()) {
            return error("Missing url query parameter");
        }
        String normalizedMethod = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        if (!"GET".equals(normalizedMethod) && !"HEAD".equals(normalizedMethod)) {
            return error("Only GET/HEAD can be proxied, got " + normalizedMethod);
        }

        final HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        boolean handedOff = false;
        try {
            connection.setRequestMethod(normalizedMethod);
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);

            for (Map.Entry<String, String> entry : requestHeaders.entrySet()) {
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
                return error("Upstream replied with unfollowed redirect " + status
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
                String value = join(entry.getValue());
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
            return new InterceptedResponse(status, reason, connection.getContentType(), responseHeaders,
                    disconnectingStream);
        } finally {
            if (!handedOff) {
                connection.disconnect();
            }
        }
    }

    /** A response produced by the proxy itself rather than by the upstream server. */
    private static InterceptedResponse synthetic(int status, String reason, String body, String errorHeader) {
        Map<String, String> headers = new HashMap<>();
        headers.put(MARKER_HEADER, "1");
        return InterceptedResponse.text(status, reason, body, headers, errorHeader);
    }

    private InterceptedResponse error(String message) {
        warn.accept("Proxy request failed: " + message);
        return synthetic(502, "Proxy Error", message, ERROR_HEADER);
    }

    /** Joins repeated header values; String.join needs API 26 and minSdk is 24. */
    private static String join(List<String> values) {
        StringBuilder joined = new StringBuilder();
        for (String value : values) {
            if (joined.length() > 0) {
                joined.append(", ");
            }
            joined.append(value);
        }
        return joined.toString();
    }
}
