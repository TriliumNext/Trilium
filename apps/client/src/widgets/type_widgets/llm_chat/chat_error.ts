import type { LlmErrorDetails } from "@triliumnext/commons";

/**
 * Build the text shown behind an error card's "show details" toggle: the endpoint that
 * was called, followed by the provider's raw response body.
 *
 * The body is dropped when it only restates the message already on the card. Providers
 * routinely answer with `{"error":{"message":"…"}}` and the AI SDK lifts that same string
 * into `error.message`, so printing both would show the failure twice — which is the whole
 * reason the raw body lives down here rather than beside the message.
 *
 * Returns undefined when nothing is left to show, so the caller can omit the toggle.
 *
 * @param message the message displayed on the card, checked against the body for redundancy.
 * @param details the failed call's context, absent for failures that never reached a provider.
 */
export function formatErrorDetails(message: string, details?: LlmErrorDetails): string | undefined {
    if (!details) {
        return undefined;
    }

    const sections: string[] = [];
    if (details.url) {
        sections.push(details.url);
    }
    if (details.responseBody && !restatesMessage(details.responseBody, message)) {
        sections.push(details.responseBody);
    }
    return sections.length > 0 ? sections.join("\n\n") : undefined;
}

/**
 * Whether a raw response body carries nothing the message doesn't already say — either
 * because it *is* that text, or because it is a JSON envelope whose message field the
 * card already shows. Unparseable bodies (an HTML error page, a truncated payload) are
 * only redundant when the message quotes them verbatim.
 */
function restatesMessage(responseBody: string, message: string): boolean {
    const body = responseBody.trim();
    if (!body || message.includes(body)) {
        return true;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return false;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return false;
    }

    const envelope = parsed as { message?: unknown; error?: { message?: unknown } };
    const reported = typeof envelope.error?.message === "string"
        ? envelope.error.message
        : typeof envelope.message === "string" ? envelope.message : undefined;
    return reported !== undefined && reported.length > 0 && message.includes(reported);
}
