package org.triliumnotes.trilium;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tracks the local API requests {@link TriliumRequestBridge} forwards to the page, from dispatch
 * until the page's reply completes them. Holds no Android classes, so it runs in plain JVM unit
 * tests; the bridge supplies the WebView, the main thread and base64 decoding.
 *
 * <p>{@link #handle} runs on a WebView IO thread: it hands the request to the page through
 * {@code window.__triliumNativeRequest()} and blocks until the head of the reply arrives. The
 * body then streams through a {@link ChunkStream}. The page's messages arrive through
 * {@link #onMessage} and {@link #onFrame}; the protocol is described in
 * {@code apps/standalone/src/native-request-bridge.ts}.
 *
 * <p>Requests that arrive before the page sends {@code ready} are queued, and
 * {@link #onPageStarted} fails whatever the previous page left unanswered.
 */
final class LocalRequestBroker {

    /** The page the requests are forwarded to. */
    interface Page {
        /**
         * Runs the script in the page, on the main thread, and reports whether it returned
         * {@code true}.
         */
        void evaluate(String script, Consumer<Boolean> accepted);
    }

    /** Must match {@code isLocalApiRequest()} in {@code apps/standalone/src/local-bridge.ts}. */
    private static final String[] LOCAL_PREFIXES = { "/bootstrap", "/api/", "/sync/", "/search/", "/custom/" };

    static final String ERROR_HEADER = "x-trilium-bridge-error";

    private static final int FRAME_HEADER_SIZE = 4;

    private final Page page;
    private final Executor mainThread;
    private final Function<String, byte[]> base64Decoder;
    private final Consumer<String> warn;
    private final long headTimeoutMs;
    private final boolean binaryChunks;

    private final AtomicInteger nextId = new AtomicInteger();
    private final Map<Integer, PendingRequest> pending = new ConcurrentHashMap<>();

    /** Guards {@link #pageReady} and {@link #queuedIds}. */
    private final Object readyLock = new Object();
    private boolean pageReady;
    private final List<Integer> queuedIds = new ArrayList<>();

    /**
     * @param binaryChunks whether the WebView carries ArrayBuffer messages; the page sends base64
     *                     chunks otherwise.
     */
    LocalRequestBroker(Page page, Executor mainThread, Function<String, byte[]> base64Decoder,
            Consumer<String> warn, long headTimeoutMs, boolean binaryChunks) {
        this.page = page;
        this.mainThread = mainThread;
        this.base64Decoder = base64Decoder;
        this.warn = warn;
        this.headTimeoutMs = headTimeoutMs;
        this.binaryChunks = binaryChunks;
    }

    /** Whether the path belongs to the local worker rather than to the app's static files. */
    static boolean isLocalPath(String path) {
        if (path == null) {
            return false;
        }
        if (path.equals("/share") || (path.startsWith("/share/") && !path.startsWith("/share/assets/"))) {
            return true;
        }
        for (String prefix : LOCAL_PREFIXES) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /** Answers a local API request. Blocks the calling thread until the page replies. */
    InterceptedResponse handle(String method, String url, Map<String, String> headers) {
        String normalizedMethod = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        if (!"GET".equals(normalizedMethod) && !"HEAD".equals(normalizedMethod)) {
            // shouldInterceptRequest exposes no request body; the page sends these through
            // standaloneApi.localFetch instead.
            return error(405, "Method Not Allowed",
                    normalizedMethod + " cannot be answered natively: the request body is not available");
        }

        int id = nextId.incrementAndGet();
        PendingRequest request = new PendingRequest();
        try {
            JSONObject payload = new JSONObject()
                .put("id", id)
                .put("method", normalizedMethod)
                .put("url", url)
                .put("headers", new JSONObject(headers))
                .put("binary", binaryChunks);
            String json = escapeLineSeparators(payload.toString());
            request.script =
                "window.__triliumNativeRequest ? (window.__triliumNativeRequest(" + json + "), true) : false";
        } catch (JSONException e) {
            return error(500, "Internal Error", "Cannot encode the request: " + e.getMessage());
        }

        pending.put(id, request);
        synchronized (readyLock) {
            if (pageReady) {
                mainThread.execute(() -> dispatch(id, request));
            } else {
                queuedIds.add(id);
            }
        }

        try {
            if (!request.headReceived.await(headTimeoutMs, TimeUnit.MILLISECONDS)) {
                pending.remove(id);
                return error(504, "Gateway Timeout", "The local worker did not answer in time");
            }
        } catch (InterruptedException e) {
            pending.remove(id);
            Thread.currentThread().interrupt();
            return error(503, "Service Unavailable", "Interrupted while waiting for the local worker");
        }

        if (request.headError != null) {
            return error(502, "Bad Gateway", request.headError);
        }
        if (request.status < 100 || request.status > 599 || (request.status >= 300 && request.status < 400)) {
            // WebResourceResponse rejects these; the page turns redirects into a 200 already.
            return error(502, "Bad Gateway", "The local worker answered with status " + request.status);
        }

        Map<String, String> responseHeaders = new HashMap<>();
        String contentType = null;
        for (Map.Entry<String, String> header : request.headers.entrySet()) {
            String name = header.getKey().toLowerCase(Locale.ROOT);
            if ("content-length".equals(name) || "content-encoding".equals(name)) {
                // The stream carries exactly the decoded bytes the page sent.
                continue;
            }
            if ("content-type".equals(name)) {
                contentType = header.getValue();
            }
            if ("content-range".equals(name) && request.status == 206) {
                request.body.startAt(rangeStart(header.getValue()));
            }
            responseHeaders.put(header.getKey(), header.getValue());
        }
        return new InterceptedResponse(request.status, reasonPhrase(request.status), contentType,
                responseHeaders, request.body);
    }

    /** Fails every request the previous page left unanswered; the new page has to announce itself. */
    void onPageStarted() {
        synchronized (readyLock) {
            pageReady = false;
            queuedIds.clear();
        }
        Iterator<PendingRequest> iterator = pending.values().iterator();
        while (iterator.hasNext()) {
            iterator.next().fail("The page reloaded before answering");
            iterator.remove();
        }
    }

    /** A JSON message from the page. Runs on the main thread. */
    void onMessage(String message) {
        try {
            JSONObject parsed = new JSONObject(message);
            String type = parsed.getString("type");
            if ("ready".equals(type)) {
                onPageReady();
                return;
            }

            int id = parsed.getInt("id");
            PendingRequest request = pending.get(id);
            if (request == null) {
                return;
            }
            switch (type) {
                case "head":
                    request.receiveHead(parsed.getInt("status"), toHeaderMap(parsed.optJSONObject("headers")));
                    break;
                case "chunk":
                    request.body.append(base64Decoder.apply(parsed.getString("data")));
                    break;
                case "end":
                    pending.remove(id);
                    request.body.finish();
                    break;
                case "error":
                    pending.remove(id);
                    request.fail(parsed.optString("message", "The local request failed"));
                    break;
                default:
                    warn.accept("Unknown message type: " + type);
            }
        } catch (JSONException e) {
            warn.accept("Malformed message from the page: " + e.getMessage());
        }
    }

    /** A binary body chunk from the page: a 4-byte big-endian request id, then the bytes. */
    void onFrame(byte[] frame) {
        if (frame.length < FRAME_HEADER_SIZE) {
            warn.accept("Body frame too short to carry a request id");
            return;
        }
        PendingRequest request = pending.get(ByteBuffer.wrap(frame).getInt());
        if (request != null) {
            request.body.append(Arrays.copyOfRange(frame, FRAME_HEADER_SIZE, frame.length));
        }
    }

    private void onPageReady() {
        List<Integer> ids;
        synchronized (readyLock) {
            pageReady = true;
            ids = new ArrayList<>(queuedIds);
            queuedIds.clear();
        }
        for (int id : ids) {
            PendingRequest request = pending.get(id);
            if (request != null) {
                dispatch(id, request);
            }
        }
    }

    private void dispatch(int id, PendingRequest request) {
        page.evaluate(request.script, accepted -> {
            if (!accepted) {
                PendingRequest rejected = pending.remove(id);
                if (rejected != null) {
                    rejected.fail("The page has no request handler");
                }
            }
        });
    }

    private InterceptedResponse error(int status, String reason, String message) {
        warn.accept(message);
        return InterceptedResponse.text(status, reason, message, new HashMap<>(), ERROR_HEADER);
    }

    /**
     * U+2028 and U+2029 are valid in JSON strings but end a line in JavaScript source, and
     * Android's {@code org.json} leaves them unescaped.
     */
    static String escapeLineSeparators(String json) {
        return json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    /** The first byte position of a {@code Content-Range: bytes S-E/T} value, or 0 if it has none. */
    static long rangeStart(String contentRange) {
        Matcher matcher = CONTENT_RANGE.matcher(contentRange.trim());
        return matcher.find() ? Long.parseLong(matcher.group(1)) : 0;
    }

    private static final Pattern CONTENT_RANGE = Pattern.compile("^bytes\\s+(\\d+)-\\d+/");

    /** WebResourceResponse requires a non-empty reason phrase. */
    static String reasonPhrase(int status) {
        switch (status) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            case 503: return "Service Unavailable";
            default: return "Status " + status;
        }
    }

    private static Map<String, String> toHeaderMap(JSONObject json) {
        Map<String, String> headers = new HashMap<>();
        if (json == null) {
            return headers;
        }
        Iterator<String> names = json.keys();
        while (names.hasNext()) {
            String name = names.next();
            headers.put(name, json.optString(name));
        }
        return headers;
    }

    /** One forwarded request, from dispatch until the page sends {@code end} or {@code error}. */
    private static final class PendingRequest {
        final CountDownLatch headReceived = new CountDownLatch(1);
        final ChunkStream body = new ChunkStream();
        String script;
        volatile int status;
        volatile Map<String, String> headers;
        volatile String headError;

        void receiveHead(int status, Map<String, String> headers) {
            this.status = status;
            this.headers = headers;
            headReceived.countDown();
        }

        void fail(String message) {
            if (headReceived.getCount() > 0) {
                headError = message;
                headReceived.countDown();
            }
            body.fail(message);
        }
    }

    /** The response body as the page sends it: a queue of chunks the WebView drains. */
    static final class ChunkStream extends InputStream {
        private static final byte[] END = new byte[0];

        private final LinkedBlockingQueue<byte[]> chunks = new LinkedBlockingQueue<>();
        private volatile String error;
        private byte[] current;
        private int position;
        private boolean finished;
        /** Set when WebView stops reading, for instance on a canceled media load; later chunks are dropped. */
        private volatile boolean closed;
        /** Bytes before the first queued one, which {@link #skip} passes over without reading. */
        private volatile long skippablePrefix;

        /**
         * Marks the body as starting at {@code offset} of the resource. WebView's loader treats an
         * intercepted stream as the whole resource and skips to the requested range start itself,
         * so for a 206 the page already cut, that skip must land on the first queued byte.
         */
        void startAt(long offset) {
            skippablePrefix = offset;
        }

        @Override
        public long skip(long n) throws IOException {
            long prefix = skippablePrefix;
            if (prefix > 0 && n > 0) {
                long skipped = Math.min(n, prefix);
                skippablePrefix = prefix - skipped;
                return skipped;
            }
            return super.skip(n);
        }

        void append(byte[] chunk) {
            if (chunk.length > 0 && !closed) {
                chunks.add(chunk);
            }
        }

        void finish() {
            chunks.add(END);
        }

        void fail(String message) {
            error = message;
            chunks.add(END);
        }

        @Override
        public int read() throws IOException {
            byte[] single = new byte[1];
            int read = read(single, 0, 1);
            return read == -1 ? -1 : single[0] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) {
                return 0;
            }
            while (current == null || position >= current.length) {
                if (finished) {
                    return -1;
                }
                try {
                    current = chunks.take();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Interrupted while reading the local response", e);
                }
                position = 0;
                if (current == END) {
                    finished = true;
                    if (error != null) {
                        throw new IOException(error);
                    }
                    return -1;
                }
            }
            int count = Math.min(length, current.length - position);
            System.arraycopy(current, position, buffer, offset, count);
            position += count;
            return count;
        }

        @Override
        public void close() {
            closed = true;
            chunks.clear();
            finished = true;
        }
    }
}
