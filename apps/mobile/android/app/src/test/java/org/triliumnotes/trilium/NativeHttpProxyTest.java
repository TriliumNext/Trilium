package org.triliumnotes.trilium;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class NativeHttpProxyTest {

    private final List<String> warnings = Collections.synchronizedList(new ArrayList<>());
    private final NativeHttpProxy proxy = new NativeHttpProxy(warnings::add, 5_000, 5_000);
    private StubServer server;
    private String baseUrl;

    @Before
    public void startServer() throws IOException {
        server = new StubServer();
        baseUrl = "http://127.0.0.1:" + server.socket.getLocalPort();
    }

    @After
    public void stopServer() throws IOException {
        server.close();
    }

    @Test
    public void recognizesItsPrefix() {
        assertTrue(NativeHttpProxy.isProxyPath("/_trilium_native_http/fetch"));
        assertFalse(NativeHttpProxy.isProxyPath("/api/notes"));
        assertFalse(NativeHttpProxy.isProxyPath(null));
    }

    @Test
    public void answersThePingWithTheMarker() throws IOException {
        InterceptedResponse response = proxy.handle("/_trilium_native_http/ping", "GET", null, new HashMap<>());

        assertEquals(200, response.status);
        assertEquals("1", response.headers.get(NativeHttpProxy.MARKER_HEADER));
        assertNull(response.headers.get(NativeHttpProxy.ERROR_HEADER));
        assertEquals("pong", read(response.body));
    }

    @Test
    public void forwardsOnlyTunneledHeadersAndReexposesCookies() throws IOException {
        Map<String, String> headers = new HashMap<>();
        headers.put("x-trilium-h-Cookie", "trilium.sid=old");
        headers.put("X-Trilium-H-Trilium-Cred", "secret");
        headers.put("User-Agent", "WebView");
        headers.put(null, "ignored");

        InterceptedResponse response = proxy.handle("/_trilium_native_http/fetch", null, baseUrl + "/ok", headers);

        assertEquals("GET /ok HTTP/1.1", server.lastRequestLine);
        assertEquals("trilium.sid=old", server.lastRequestHeaders.get("cookie"));
        assertEquals("secret", server.lastRequestHeaders.get("trilium-cred"));
        assertFalse("WebView headers stay off the sync connection",
                "WebView".equals(server.lastRequestHeaders.get("user-agent")));

        assertEquals(200, response.status);
        assertEquals("OK", response.reasonPhrase);
        assertEquals("application/json", response.mimeType);
        assertEquals("utf-8", response.encoding);
        assertEquals("trilium.sid=abc", response.headers.get("x-trilium-set-cookie"));
        assertFalse(hasHeader(response, "set-cookie"));
        assertFalse(hasHeader(response, "content-length"));
        assertTrue(hasHeader(response, "content-type"));
        String multi = response.headers.get("X-Multi");
        assertTrue(multi, "a, b".equals(multi) || "b, a".equals(multi));
        assertEquals("{\"ok\":true}", read(response.body));
        response.body.close();
    }

    @Test
    public void passesUpstreamErrorsThrough() throws IOException {
        InterceptedResponse missing = proxy.handle("/_trilium_native_http/fetch", "GET", baseUrl + "/missing",
                new HashMap<>());
        assertEquals(404, missing.status);
        assertEquals("no such note", read(missing.body));

        InterceptedResponse empty = proxy.handle("/_trilium_native_http/fetch", "HEAD", baseUrl + "/empty-error",
                new HashMap<>());
        assertEquals(500, empty.status);
        assertEquals("", read(empty.body));
        assertTrue(warnings.isEmpty());
    }

    @Test
    public void namesAStatusThatCameWithoutAReasonPhrase() throws IOException {
        InterceptedResponse response = proxy.handle("/_trilium_native_http/fetch", "GET", baseUrl + "/no-reason",
                new HashMap<>());

        assertEquals(200, response.status);
        assertEquals("Status 200", response.reasonPhrase);
    }

    @Test
    public void answersItsOwnFailuresWithABadGateway() throws IOException {
        int closedPort;
        try (ServerSocket socket = new ServerSocket(0)) {
            closedPort = socket.getLocalPort();
        }
        String[][] cases = {
            { "/_trilium_native_http/teleport", "GET", baseUrl + "/ok", "Unknown proxy action: teleport" },
            { "/_trilium_native_http/fetch", "GET", null, "Missing url query parameter" },
            { "/_trilium_native_http/fetch", "GET", "", "Missing url query parameter" },
            { "/_trilium_native_http/fetch", "POST", baseUrl + "/ok", "Only GET/HEAD can be proxied, got POST" },
            { "/_trilium_native_http/fetch", "GET", baseUrl + "/redirect",
                "Upstream replied with unfollowed redirect 302 to https://example.org/elsewhere" },
            { "/_trilium_native_http/fetch", "GET", "http://127.0.0.1:" + closedPort + "/", "ConnectException: " },
        };

        for (String[] testCase : cases) {
            InterceptedResponse response = proxy.handle(testCase[0], testCase[1], testCase[2], new HashMap<>());
            String error = response.headers.get(NativeHttpProxy.ERROR_HEADER);

            assertEquals(testCase[3], 502, response.status);
            assertEquals("1", response.headers.get(NativeHttpProxy.MARKER_HEADER));
            assertTrue(error, error.startsWith(testCase[3]));
            assertEquals(error, read(response.body));
        }
        assertEquals(cases.length, warnings.size());
    }

    @Test
    public void sanitizesErrorHeadersButNotTheBody() throws IOException {
        InterceptedResponse response = proxy.handle("/_trilium_native_http/café", "GET", null, new HashMap<>());

        assertEquals("Unknown proxy action: caf ", response.headers.get(NativeHttpProxy.ERROR_HEADER));
        assertEquals("Unknown proxy action: café", read(response.body));
    }

    @Test
    public void parsesContentTypes() {
        InterceptedResponse bare = new InterceptedResponse(200, "OK", "text/html", new HashMap<>(), null);
        assertEquals("text/html", bare.mimeType);
        assertNull(bare.encoding);

        InterceptedResponse withParameters =
                new InterceptedResponse(200, "OK", "text/css; q=1; charset=ISO-8859-1", new HashMap<>(), null);
        assertEquals("text/css", withParameters.mimeType);
        assertEquals("ISO-8859-1", withParameters.encoding);

        InterceptedResponse parametersOnly = new InterceptedResponse(200, "OK", "; charset=utf-8", new HashMap<>(), null);
        assertEquals("application/octet-stream", parametersOnly.mimeType);
        assertEquals("utf-8", parametersOnly.encoding);
    }

    /**
     * Answers canned HTTP/1.1 responses by path, one connection at a time. Unit tests compile
     * against android.jar, which has no {@code com.sun.net.httpserver}.
     */
    private static final class StubServer implements Closeable {
        final ServerSocket socket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        volatile String lastRequestLine;
        final Map<String, String> lastRequestHeaders = new ConcurrentHashMap<>();

        StubServer() throws IOException {
            Thread thread = new Thread(this::serve, "stub-http-server");
            thread.setDaemon(true);
            thread.start();
        }

        private void serve() {
            while (!socket.isClosed()) {
                try (Socket connection = socket.accept()) {
                    answer(connection);
                } catch (IOException e) {
                    // The socket closed at the end of the test, or a client hung up.
                }
            }
        }

        private void answer(Socket connection) throws IOException {
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.ISO_8859_1));
            String requestLine = reader.readLine();
            Map<String, String> headers = new HashMap<>();
            for (String line = reader.readLine(); line != null && !line.isEmpty(); line = reader.readLine()) {
                int colon = line.indexOf(':');
                headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
            }
            lastRequestHeaders.clear();
            lastRequestHeaders.putAll(headers);
            lastRequestLine = requestLine;

            String path = requestLine.split(" ")[1];
            String response;
            switch (path) {
                case "/ok":
                    response = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
                            + "Set-Cookie: trilium.sid=abc\r\nX-Multi: a\r\nX-Multi: b\r\n"
                            + "Content-Length: 11\r\n\r\n{\"ok\":true}";
                    break;
                case "/missing":
                    response = "HTTP/1.1 404 Not Found\r\nContent-Length: 12\r\n\r\nno such note";
                    break;
                case "/empty-error":
                    response = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";
                    break;
                case "/redirect":
                    response = "HTTP/1.1 302 Found\r\nLocation: https://example.org/elsewhere\r\n"
                            + "Content-Length: 0\r\n\r\n";
                    break;
                case "/no-reason":
                    response = "HTTP/1.1 200 \r\nContent-Length: 0\r\n\r\n";
                    break;
                default:
                    response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
            }
            OutputStream out = connection.getOutputStream();
            out.write(response.replace("\r\n\r\n", "\r\nConnection: close\r\n\r\n")
                    .getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        }

        @Override
        public void close() throws IOException {
            socket.close();
        }
    }

    private static boolean hasHeader(InterceptedResponse response, String name) {
        for (String key : response.headers.keySet()) {
            if (key.equalsIgnoreCase(name)) {
                return true;
            }
        }
        return false;
    }

    private static String read(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
