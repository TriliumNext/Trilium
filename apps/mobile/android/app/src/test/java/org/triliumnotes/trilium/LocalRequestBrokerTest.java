package org.triliumnotes.trilium;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LocalRequestBrokerTest {

    private static final long WAIT_MS = 5_000;

    private final List<String> scripts = Collections.synchronizedList(new ArrayList<>());
    private final List<String> warnings = Collections.synchronizedList(new ArrayList<>());
    private final ExecutorService io = Executors.newCachedThreadPool();
    private volatile boolean pageAccepts = true;

    @After
    public void tearDown() {
        io.shutdownNow();
    }

    @Test
    public void recognizesTheWorkerPaths() {
        for (String path : new String[] {
                "/bootstrap", "/api/notes", "/sync/changed", "/search/x", "/custom/hook", "/share", "/share/abc" }) {
            assertTrue(path, LocalRequestBroker.isLocalPath(path));
        }
        for (String path : new String[] { "/share/assets/style.css", "/sharex", "/index.html", "/apix", null }) {
            assertFalse(String.valueOf(path), LocalRequestBroker.isLocalPath(path));
        }
    }

    @Test
    public void rejectsMethodsThatCarryABody() throws Exception {
        LocalRequestBroker broker = broker(WAIT_MS, true);
        InterceptedResponse response = broker.handle("post", "https://localhost/api/notes", new HashMap<>());

        assertEquals(405, response.status);
        assertEquals("POST cannot be answered natively: the request body is not available",
                response.headers.get(LocalRequestBroker.ERROR_HEADER));
        assertEquals(response.headers.get(LocalRequestBroker.ERROR_HEADER), read(response.body));
        assertTrue(scripts.isEmpty());
    }

    @Test
    public void queuesUntilReadyThenStreamsBinaryFrames() throws Exception {
        LocalRequestBroker broker = broker(WAIT_MS, true);
        Map<String, String> headers = new HashMap<>();
        headers.put("Range", "bytes=0-");
        Future<InterceptedResponse> pending = request(broker, null, "https://localhost/api/images/x", headers);

        Thread.sleep(100);
        assertTrue("nothing is dispatched before the page is ready", scripts.isEmpty());

        broker.onMessage("{\"type\":\"ready\"}");
        String script = awaitScript(0);
        int id = idOf(script);
        assertTrue(script, script.startsWith("window.__triliumNativeRequest ? (window.__triliumNativeRequest({"));
        assertTrue(script, script.contains("\"method\":\"GET\""));
        assertTrue(script, script.contains("\"binary\":true"));
        assertTrue(script, script.contains("\"Range\":\"bytes=0-\""));
        assertTrue(script, script.contains("localhost") && script.contains("images"));

        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":206,\"headers\":{"
                + "\"Content-Type\":\"text/plain; charset=utf-8\",\"Content-Length\":\"999\","
                + "\"content-encoding\":\"gzip\",\"x-custom\":\"1\"}}");
        InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);

        // The head completes the response; the body streams in afterwards.
        broker.onFrame(frame(id, "hel"));
        broker.onFrame(frame(id, "lo"));
        broker.onMessage("{\"type\":\"end\",\"id\":" + id + "}");

        assertEquals(206, response.status);
        assertEquals("Partial Content", response.reasonPhrase);
        assertEquals("text/plain", response.mimeType);
        assertEquals("utf-8", response.encoding);
        assertEquals("1", response.headers.get("x-custom"));
        assertFalse(response.headers.containsKey("Content-Length"));
        assertFalse(response.headers.containsKey("content-encoding"));
        assertEquals("hello", read(response.body));
    }

    @Test
    public void letsWebViewSkipToARangeThePageAlreadyCut() throws Exception {
        LocalRequestBroker broker = readyBroker();
        Map<String, String> headers = new HashMap<>();
        headers.put("Range", "bytes=1000-");
        Future<InterceptedResponse> pending = request(broker, null, "https://localhost/api/notes/v/open-partial", headers);
        int id = idOf(awaitScript(0));

        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":206,\"headers\":{"
                + "\"content-range\":\"bytes 1000-1004/5000\"}}");
        InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);
        broker.onFrame(frame(id, "slice"));
        broker.onMessage("{\"type\":\"end\",\"id\":" + id + "}");

        // WebView treats the stream as the whole resource and skips to the range start itself,
        // in a loop, as SkipToRequestedRange in Chromium's input_stream_reader.cc does.
        assertEquals(0, response.body.available());
        assertEquals(0, response.body.skip(0));
        long toSkip = 1000;
        while (toSkip > 0) {
            long skipped = response.body.skip(toSkip);
            assertTrue("the skip must make progress", skipped > 0);
            toSkip -= skipped;
        }
        assertEquals("slice", read(response.body));
    }

    @Test
    public void skipsRealBytesWhenTheResponseIsNotARange() throws Exception {
        LocalRequestBroker broker = readyBroker();
        Future<InterceptedResponse> pending = request(broker, null, "https://localhost/api/notes/x", new HashMap<>());
        int id = idOf(awaitScript(0));

        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":200,\"headers\":{"
                + "\"Content-Range\":\"bytes 0-4/5\"}}");
        InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);
        broker.onFrame(frame(id, "whole"));
        broker.onMessage("{\"type\":\"end\",\"id\":" + id + "}");

        assertEquals(2, response.body.skip(2));
        assertEquals("ole", read(response.body));

        Future<InterceptedResponse> unsatisfiable = request(broker, null, "https://localhost/api/notes/y", new HashMap<>());
        int rangeId = idOf(awaitScript(1));
        broker.onMessage("{\"type\":\"head\",\"id\":" + rangeId + ",\"status\":206,\"headers\":{"
                + "\"content-range\":\"bytes */5\"}}");
        InterceptedResponse range = unsatisfiable.get(WAIT_MS, TimeUnit.MILLISECONDS);
        broker.onFrame(frame(rangeId, "whole"));
        broker.onMessage("{\"type\":\"end\",\"id\":" + rangeId + "}");

        assertEquals(2, range.body.skip(2));
        assertEquals("ole", read(range.body));
    }

    @Test
    public void dispatchesAtOnceWhenReadyAndDecodesBase64Chunks() throws Exception {
        LocalRequestBroker broker = broker(WAIT_MS, false);
        broker.onMessage("{\"type\":\"ready\"}");
        Future<InterceptedResponse> pending = request(broker, "HEAD", "https://localhost/api/notes", new HashMap<>());

        String script = awaitScript(0);
        int id = idOf(script);
        assertTrue(script, script.contains("\"binary\":false"));
        assertTrue(script, script.contains("\"method\":\"HEAD\""));

        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":200}");
        broker.onMessage("{\"type\":\"chunk\",\"id\":" + id + ",\"data\":\""
                + Base64.getEncoder().encodeToString("hi".getBytes(StandardCharsets.UTF_8)) + "\"}");
        broker.onMessage("{\"type\":\"end\",\"id\":" + id + "}");

        InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);
        assertEquals(200, response.status);
        assertEquals("OK", response.reasonPhrase);
        assertEquals("application/octet-stream", response.mimeType);
        assertNull(response.encoding);
        assertEquals("hi", read(response.body));
    }

    @Test
    public void reportsAnErrorBeforeTheHeadAsABadGateway() throws Exception {
        LocalRequestBroker broker = readyBroker();
        Future<InterceptedResponse> pending = request(broker, "GET", "https://localhost/api/x", new HashMap<>());
        int id = idOf(awaitScript(0));

        broker.onMessage("{\"type\":\"error\",\"id\":" + id + ",\"message\":\"worker gone\"}");

        InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);
        assertEquals(502, response.status);
        assertEquals("worker gone", read(response.body));
        assertTrue(warnings.contains("worker gone"));
    }

    @Test
    public void failsTheBodyStreamOnAnErrorAfterTheHead() throws Exception {
        LocalRequestBroker broker = readyBroker();
        Future<InterceptedResponse> pending = request(broker, "GET", "https://localhost/api/x", new HashMap<>());
        int id = idOf(awaitScript(0));

        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":200,\"headers\":{}}");
        broker.onFrame(frame(id, "partial"));
        broker.onMessage("{\"type\":\"error\",\"id\":" + id + "}");

        InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);
        byte[] buffer = new byte[16];
        assertEquals(7, response.body.read(buffer, 0, buffer.length));
        IOException error = assertThrows(IOException.class, () -> response.body.read(buffer, 0, buffer.length));
        assertEquals("The local request failed", error.getMessage());
        assertEquals("a failed stream stays finished", -1, response.body.read(buffer, 0, buffer.length));
    }

    @Test
    public void failsARequestThePageCannotTake() throws Exception {
        pageAccepts = false;
        LocalRequestBroker broker = readyBroker();
        InterceptedResponse response = broker.handle("GET", "https://localhost/api/x", new HashMap<>());

        assertEquals(502, response.status);
        assertEquals("The page has no request handler", read(response.body));
    }

    @Test
    public void ignoresARejectionThatArrivesAfterTheRequestFailed() throws Exception {
        List<Consumer<Boolean>> verdicts = Collections.synchronizedList(new ArrayList<>());
        LocalRequestBroker broker = new LocalRequestBroker(
            (script, accepted) -> verdicts.add(accepted),
            Runnable::run,
            data -> Base64.getDecoder().decode(data),
            warnings::add,
            WAIT_MS,
            true);
        broker.onMessage("{\"type\":\"ready\"}");
        Future<InterceptedResponse> pending = request(broker, "GET", "https://localhost/api/x", new HashMap<>());
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (verdicts.isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(5);
        }

        broker.onPageStarted();
        verdicts.get(0).accept(false);

        assertEquals("The page reloaded before answering", read(pending.get(WAIT_MS, TimeUnit.MILLISECONDS).body));
    }

    @Test
    public void failsPendingRequestsOnReloadAndWaitsForTheNewPage() throws Exception {
        LocalRequestBroker broker = readyBroker();
        Future<InterceptedResponse> first = request(broker, "GET", "https://localhost/api/a", new HashMap<>());
        awaitScript(0);

        broker.onPageStarted();
        InterceptedResponse failed = first.get(WAIT_MS, TimeUnit.MILLISECONDS);
        assertEquals(502, failed.status);
        assertEquals("The page reloaded before answering", read(failed.body));

        Future<InterceptedResponse> second = request(broker, "GET", "https://localhost/api/b", new HashMap<>());
        Thread.sleep(100);
        assertEquals("the reloaded page has not announced itself yet", 1, scripts.size());

        broker.onMessage("{\"type\":\"ready\"}");
        int id = idOf(awaitScript(1));
        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":204}");
        broker.onMessage("{\"type\":\"end\",\"id\":" + id + "}");
        InterceptedResponse response = second.get(WAIT_MS, TimeUnit.MILLISECONDS);
        assertEquals(204, response.status);
        assertEquals("No Content", response.reasonPhrase);
        assertEquals("", read(response.body));
    }

    @Test
    public void timesOutWhenThePageNeverAnswers() throws Exception {
        LocalRequestBroker broker = broker(50, true);
        InterceptedResponse response = broker.handle("GET", "https://localhost/api/x", new HashMap<>());

        assertEquals(504, response.status);
        assertEquals("Gateway Timeout", response.reasonPhrase);

        broker.onMessage("{\"type\":\"ready\"}");
        assertTrue("a request that timed out in the queue is not dispatched", scripts.isEmpty());
    }

    @Test
    public void answersServiceUnavailableWhenInterrupted() throws Exception {
        LocalRequestBroker broker = broker(WAIT_MS, true);
        AtomicReference<InterceptedResponse> result = new AtomicReference<>();
        Thread thread = new Thread(() -> result.set(broker.handle("GET", "https://localhost/api/x", new HashMap<>())));
        thread.start();
        Thread.sleep(100);
        thread.interrupt();
        thread.join(WAIT_MS);

        assertEquals(503, result.get().status);
    }

    @Test
    public void rejectsStatusesWebResourceResponseCannotCarry() throws Exception {
        LocalRequestBroker broker = readyBroker();
        int[] statuses = { 302, 99, 600 };
        for (int i = 0; i < statuses.length; i++) {
            int status = statuses[i];
            Future<InterceptedResponse> pending = request(broker, "GET", "https://localhost/share/x", new HashMap<>());
            int id = idOf(awaitScript(i));
            broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":" + status + "}");

            InterceptedResponse response = pending.get(WAIT_MS, TimeUnit.MILLISECONDS);
            assertEquals(502, response.status);
            assertEquals("The local worker answered with status " + status, read(response.body));
        }

        Future<InterceptedResponse> pending = request(broker, "GET", "https://localhost/api/missing", new HashMap<>());
        int id = idOf(awaitScript(statuses.length));
        broker.onMessage("{\"type\":\"head\",\"id\":" + id + ",\"status\":404}");
        broker.onMessage("{\"type\":\"end\",\"id\":" + id + "}");
        assertEquals(404, pending.get(WAIT_MS, TimeUnit.MILLISECONDS).status);
    }

    @Test
    public void ignoresMessagesItCannotPlace() throws Exception {
        LocalRequestBroker broker = readyBroker();
        broker.onFrame(new byte[] { 0, 1 });
        broker.onFrame(frame(999, "stray"));
        broker.onMessage("not json");
        broker.onMessage("{\"type\":\"head\",\"id\":999,\"status\":200}");

        Future<InterceptedResponse> pending = request(broker, "GET", "https://localhost/api/x", new HashMap<>());
        int id = idOf(awaitScript(0));
        broker.onMessage("{\"type\":\"surprise\",\"id\":" + id + "}");

        assertEquals(3, warnings.size());
        assertEquals("Body frame too short to carry a request id", warnings.get(0));
        assertTrue(warnings.get(1), warnings.get(1).startsWith("Malformed message from the page"));
        assertEquals("Unknown message type: surprise", warnings.get(2));
        assertFalse("the request is still waiting for its head", pending.isDone());
    }

    @Test
    public void escapesLineSeparatorsForTheScript() {
        // Called directly: the test classpath's org.json escapes these already, Android's does not.
        assertEquals("{\"url\":\"a\\u2028b\\u2029c\"}",
                LocalRequestBroker.escapeLineSeparators("{\"url\":\"a\u2028b\u2029c\"}"));
    }

    @Test
    public void namesUncommonStatusesByNumber() {
        String[] expected = {
            "200 OK", "201 Created", "204 No Content", "206 Partial Content", "400 Bad Request",
            "401 Unauthorized", "403 Forbidden", "404 Not Found", "500 Internal Server Error",
            "503 Service Unavailable" };
        for (String line : expected) {
            int status = Integer.parseInt(line.substring(0, 3));
            assertEquals(line.substring(4), LocalRequestBroker.reasonPhrase(status));
        }
        assertEquals("Status 418", LocalRequestBroker.reasonPhrase(418));
    }

    @Test
    public void chunkStreamReadsSingleBytesAndStopsWhenClosed() throws Exception {
        LocalRequestBroker.ChunkStream stream = new LocalRequestBroker.ChunkStream();
        stream.append(new byte[] { (byte) 0xff, 2 });
        stream.append(new byte[0]);
        stream.finish();

        assertEquals(0, stream.read(new byte[4], 0, 0));
        assertEquals(0xff, stream.read());
        assertEquals(2, stream.read());
        assertEquals(-1, stream.read());

        LocalRequestBroker.ChunkStream closed = new LocalRequestBroker.ChunkStream();
        closed.append(new byte[] { 1 });
        closed.close();
        assertEquals(-1, closed.read());

        // WebView closes the stream when a media load is canceled, while the page keeps sending.
        closed.append(new byte[] { 2 });
        Field chunks = LocalRequestBroker.ChunkStream.class.getDeclaredField("chunks");
        chunks.setAccessible(true);
        assertTrue("a closed stream must not buffer what the page sends after it",
                ((Collection<?>) chunks.get(closed)).isEmpty());
    }

    @Test
    public void chunkStreamFailsAReadThatIsInterrupted() throws Exception {
        LocalRequestBroker.ChunkStream stream = new LocalRequestBroker.ChunkStream();
        AtomicReference<Exception> failure = new AtomicReference<>();
        Thread reader = new Thread(() -> {
            try {
                stream.read();
            } catch (IOException e) {
                failure.set(e);
            }
        });
        reader.start();
        Thread.sleep(100);
        reader.interrupt();
        reader.join(WAIT_MS);

        assertEquals("Interrupted while reading the local response", failure.get().getMessage());
    }

    private LocalRequestBroker broker(long headTimeoutMs, boolean binaryChunks) {
        return new LocalRequestBroker(
            (script, accepted) -> {
                scripts.add(script);
                accepted.accept(pageAccepts);
            },
            Runnable::run,
            data -> Base64.getDecoder().decode(data),
            warnings::add,
            headTimeoutMs,
            binaryChunks);
    }

    private LocalRequestBroker readyBroker() {
        LocalRequestBroker broker = broker(WAIT_MS, true);
        broker.onMessage("{\"type\":\"ready\"}");
        return broker;
    }

    private Future<InterceptedResponse> request(LocalRequestBroker broker, String method, String url,
            Map<String, String> headers) {
        return io.submit(() -> broker.handle(method, url, headers));
    }

    private String awaitScript(int index) throws InterruptedException {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (scripts.size() <= index) {
            if (System.currentTimeMillis() > deadline) {
                throw new AssertionError("No script #" + index + " was dispatched");
            }
            Thread.sleep(5);
        }
        return scripts.get(index);
    }

    private static int idOf(String script) {
        Matcher matcher = Pattern.compile("\"id\":(\\d+)").matcher(script);
        assertTrue(script, matcher.find());
        return Integer.parseInt(matcher.group(1));
    }

    private static byte[] frame(int id, String payload) {
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(4 + bytes.length).putInt(id).put(bytes).array();
    }

    private static String read(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[3];
        int read;
        while ((read = stream.read(buffer, 0, buffer.length)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
