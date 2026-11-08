package org.triliumnotes.trilium;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The parts of a {@code WebResourceResponse}, held without Android classes so that
 * {@link LocalRequestBroker} and {@link NativeHttpProxy} run in plain JVM unit tests.
 * {@code TriliumWebViewClient} turns it into the real response.
 */
final class InterceptedResponse {

    final int status;
    final String reasonPhrase;
    final String mimeType;
    /** Null when the response names no charset. */
    final String encoding;
    final Map<String, String> headers;
    final InputStream body;

    InterceptedResponse(int status, String reasonPhrase, String contentType,
            Map<String, String> headers, InputStream body) {
        this.status = status;
        this.reasonPhrase = reasonPhrase;
        this.headers = headers;
        this.body = body;

        String mime = "application/octet-stream";
        String charset = null;
        if (contentType != null) {
            String[] parts = contentType.split(";");
            if (!parts[0].trim().isEmpty()) {
                mime = parts[0].trim();
            }
            for (int i = 1; i < parts.length; i++) {
                String part = parts[i].trim();
                if (part.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                    charset = part.substring("charset=".length()).trim();
                }
            }
        }
        this.mimeType = mime;
        this.encoding = charset;
    }

    /** A plain-text response with the message as its body and in {@code errorHeader}, if given. */
    static InterceptedResponse text(int status, String reasonPhrase, String message,
            Map<String, String> headers, String errorHeader) {
        Map<String, String> allHeaders = new HashMap<>(headers);
        if (errorHeader != null) {
            allHeaders.put(errorHeader, sanitizeHeaderValue(message));
        }
        return new InterceptedResponse(status, reasonPhrase, "text/plain; charset=utf-8", allHeaders,
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    /** Exception messages can contain characters that are not valid in a header value. */
    static String sanitizeHeaderValue(String value) {
        return value.replaceAll("[^\\x20-\\x7e]", " ");
    }
}
