/**
 * The transport every provider talks to its endpoint through — its model listing, and the calls
 * the vendor SDK makes on its behalf.
 *
 * It exists because `baseURL` is a free-text field. A provider configuration names where the
 * requests go, and the requests are made by the server rather than by the browser that asked for
 * them, so a base URL is an instruction to the server to connect somewhere. Left on the global
 * `fetch`, that is an instruction it follows anywhere at all — including to the address a cloud
 * instance answers its own credentials on.
 *
 * What it is *not* is a rule that endpoints must be public. Local model servers are the reason
 * half these providers exist: Ollama and LM Studio both default to loopback, and either may as
 * easily be a machine on the LAN. Those addresses stay reachable. Refused are the ranges no model
 * server is served on and only a metadata endpoint answers — see the policy in the server's
 * `safe_fetch`, which is where the address is actually vetted.
 */

import { getRequestProvider } from "../../request.js";

/**
 * A `fetch` for a provider endpoint, in the shape the AI SDKs take as their `fetch` option.
 *
 * On the server this resolves the host and refuses the metadata ranges; in the browser builds it
 * is the page's own `fetch`, which is all that runtime has and all it needs. Each implementation
 * says why on itself.
 */
export const llmFetch: typeof globalThis.fetch = async (input, init) =>
    await getRequestProvider().fetchApi(urlOf(input), init ?? {}, { allowPrivateNetwork: true });

/**
 * Why a call to {@link llmFetch} failed to get an answer. On the server, undici rejects every
 * transport failure with a `TypeError` of "fetch failed" and keeps the reason, such as
 * `connect ECONNREFUSED 192.168.1.10:8080`, in its `cause`; an error without one is described by
 * its own message.
 */
export function fetchFailureReason(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }
    return describeCause(error.cause) ?? error.message;
}

/**
 * The message of a network error. Node rejects a connection attempted on several addresses (IPv6
 * and IPv4 for `localhost`) with an `AggregateError` without a message, so its errors are listed.
 */
function describeCause(cause: unknown): string | undefined {
    if (!(cause instanceof Error)) {
        return undefined;
    }
    if (cause.message) {
        return cause.message;
    }
    if (cause instanceof AggregateError) {
        const reasons = cause.errors.map(describeCause).filter((reason) => reason !== undefined);
        if (reasons.length) {
            return reasons.join("; ");
        }
    }
    const { code } = cause as { code?: unknown };
    return typeof code === "string" ? code : undefined;
}

/**
 * The address out of whatever `fetch` was handed.
 *
 * A `Request` is refused rather than unpacked: its body is a stream that reading here would
 * consume, so honouring one means rebuilding the whole request rather than reading a field off it.
 * Nothing calls it that way — the SDKs pass a URL and an init, and so do we — and a silent
 * half-translation would be worse than the throw if anything ever did.
 */
function urlOf(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.toString();
    }
    throw new Error("llmFetch does not accept a Request; pass a URL and an init instead.");
}
