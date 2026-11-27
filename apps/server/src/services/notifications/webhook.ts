/**
 * @module
 *
 * The webhook channel type: a `POST` of the payload, or of the body template filled in, to the
 * address of the secrets file, under the policy of `safeFetch()`.
 */
import type { NotificationChannelConfig, NotificationWebhookNetwork } from "@triliumnext/commons";
import {
    checkTemplate,
    fillTemplate
} from "@triliumnext/core/src/services/notifications/channels/body_template.js";
import {
    ChannelSendError,
    type ChannelSendRequest,
    type NotificationChannelType
} from "@triliumnext/core/src/services/notifications/channels/types.js";
import { NotificationError } from "@triliumnext/core/src/services/notifications/model.js";
import crypto from "crypto";
import { t } from "i18next";

import { safeFetch, SafeFetchRefusal, type SafeFetchPolicy } from "../safe_fetch.js";
import {
    getSecretEntry,
    isNetworkAllowed,
    type NotificationSecretEntry
} from "./notification_secrets.js";

/** The longest wait that a receiver can ask for with `Retry-After`. */
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const PUBLIC_ONLY: NotificationWebhookNetwork = { allowPrivate: false, allowLoopback: false };

export const webhookChannelType: NotificationChannelType = {
    type: "webhook",
    get title() {
        return t("notifications.channel-type-webhook");
    },
    icon: "bx bx-link-external",
    isAvailable: () => true,
    checkConfig,
    getAddressState(channelId) {
        const entry = getSecretEntry(channelId);
        return entry && {
            configurationId: entry.configurationId,
            templateHash: entry.templateHash,
            changedAt: entry.changedAt
        };
    },
    send
};

/**
 * Checks the configuration of a webhook that syncs: `{ template? }`.
 *
 * @throws NotificationError `invalid-input`, `too-large` or `invalid-template`.
 */
function checkConfig(value: unknown): NotificationChannelConfig {
    if (value === undefined) {
        return {};
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)
        || Object.keys(value).some((field) => field !== "template")) {
        throw new NotificationError("invalid-input");
    }
    const { template } = value as NotificationChannelConfig;
    return template === undefined ? {} : { template: checkTemplate(template) };
}

/**
 * Makes one attempt. The entry is read before the first `await`, so that a change of the
 * secrets file after the call cannot reach the request.
 *
 * The headers are the user's, then `Content-Type: application/json` and `Idempotency-Key` with the
 * delivery key. undici sets `Host`, `Content-Length` and `Connection`, no `Transfer-Encoding` for
 * a body of known length, and keeps no cookies. With a signing secret, the webhook adds
 * `X-Trilium-Timestamp`, the Unix time in seconds, and `X-Trilium-Signature`, the HMAC-SHA256 of
 * `<timestamp>.<body>` in UTF-8 under the signing secret, in lowercase hex.
 *
 * @throws ChannelSendError with the code of the failure, never with a message of the receiver.
 */
async function send({ channelId, template, payload, delivery }: ChannelSendRequest) {
    const entry = getSecretEntry(channelId);
    if (!entry) {
        throw new ChannelSendError("secret");
    }
    const body = fillTemplate(template, payload, entry.values);
    const init: RequestInit = {
        method: "POST", headers: getHeaders(entry, body, payload.key), body, signal: delivery.signal
    };

    let response: Response;
    try {
        response = await safeFetch(entry.url, init, getPolicy(entry.network));
    } catch (e) {
        throw toSendError(e, delivery.signal);
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    await response.body?.cancel();
    if (!response.ok) {
        throw new ChannelSendError("http", { httpStatus: response.status, retryAfterMs });
    }
}

/** The user's headers, then those that the webhook sets, then the signature. */
function getHeaders(entry: NotificationSecretEntry, body: string, key: string) {
    const headers: [ string, string ][] = [
        ...entry.headers,
        [ "Content-Type", "application/json" ],
        [ "Idempotency-Key", key ]
    ];
    if (entry.signingSecret !== undefined) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = crypto.createHmac("sha256", entry.signingSecret)
            .update(`${timestamp}.${body}`, "utf-8")
            .digest("hex");
        headers.push([ "X-Trilium-Timestamp", timestamp ], [ "X-Trilium-Signature", signature ]);
    }
    return headers;
}

/**
 * Public HTTPS addresses, and the local ranges of the entry where the host allows them. Plain
 * HTTP goes to local addresses only, no redirect is followed, and the signal of the attempt is
 * the only deadline.
 */
function getPolicy(network: NotificationWebhookNetwork): SafeFetchPolicy {
    return {
        localRanges: isNetworkAllowed() ? network : PUBLIC_ONLY,
        isPlainHttpLocalOnly: true,
        maxRedirects: 0,
        timeoutMs: null
    };
}

function toSendError(error: unknown, signal: AbortSignal) {
    if (error instanceof SafeFetchRefusal) {
        return new ChannelSendError(
            error.reason === "redirect" ? "redirect" : "refused-destination");
    }
    return new ChannelSendError(signal.aborted ? "timeout" : "network");
}

/** `Retry-After`, in seconds or as an HTTP date, in milliseconds from now and at most an hour. */
function parseRetryAfter(value: string | null): number | undefined {
    if (value === null) {
        return undefined;
    }
    const text = value.trim();
    const ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - Date.now();
    return Number.isNaN(ms) ? undefined : Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}
