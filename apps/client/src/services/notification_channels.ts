/**
 * @module
 *
 * The channels that forward notifications, on the client: the requests of the channels card, and
 * the run of a frontend channel whose delivery this tab claims. Loaded with the channels card and
 * on the first `notification-forward` message.
 */
import type {
    NotificationChannelBundle, NotificationChannelConfigWidgetResponse,
    NotificationChannelCreateRequest, NotificationChannelEditRequest,
    NotificationChannelEnableRequest, NotificationChannelListResponse, NotificationChannelPayload,
    NotificationChannelResponse, NotificationChannelReview, NotificationChannelSecretDeleteRequest,
    NotificationChannelSecretPutRequest, NotificationChannelSecretView,
    NotificationChannelSettingsRequest, NotificationChannelSwitchResponse,
    NotificationChannelTestResponse, NotificationDeliveryClaimRequest,
    NotificationDeliveryClaimResponse, NotificationDeliveryResultRequest,
    NotificationForwardingResumeRequest, WebSocketMessage
} from "@triliumnext/commons";
import {
    NOTIFICATION_DELIVERY_DEADLINE_MS
} from "@triliumnext/commons/src/lib/notification_channels.js";

import { executeBundleWithoutErrorHandling } from "./bundle.js";
import { getErrorCode, NotificationRequestError, SILENT_REFUSALS } from "./notifications.js";
import server, { type Credentials } from "./server.js";
import { randomString } from "./utils.js";
import { logError } from "./ws.js";

/** How long a frontend channel runs before `api.delivery.signal` aborts. */
export const DELIVERY_TIMEOUT_MS = 30_000;
/** The profile ID of a tab that cannot open IndexedDB. */
export const FALLBACK_PROFILE_ID = "fallback";
const PROFILE_ID_LENGTH = 20;
const PROFILE_DATABASE = "trilium-notification-channels";
const PROFILE_STORE = "profiles";
const CHANNELS_URL = "notification-channels";

type ForwardMessage = Extract<WebSocketMessage, { type: "notification-forward" }>;

/**
 * Claims a delivery that the backend announced, and runs the channel's bundle when the claim is
 * granted. The result reports a failure by its code only.
 */
export async function runForwardedDelivery({ deliveryKey }: ForwardMessage) {
    const profileId = await getProfileId();
    const claimRequest: NotificationDeliveryClaimRequest = { deliveryKey, profileId };
    let claim: NotificationDeliveryClaimResponse;
    try {
        claim = await server.postWithSilentErrors<NotificationDeliveryClaimResponse>(
            `${CHANNELS_URL}/deliveries/claim`, claimRequest);
    } catch (e) {
        reportFailure("claim", e);
        return;
    }

    const { granted, bundle, payload } = claim;
    if (!granted || !bundle || !payload) {
        return;
    }

    const outcome = await runChannel(bundle, payload, {
        key: deliveryKey,
        attempt: claim.attempt ?? 1,
        channelSettings: claim.channelSettings ?? {}
    });
    const result: NotificationDeliveryResultRequest = { deliveryKey, profileId, ...outcome };
    try {
        await server.postWithSilentErrors(`${CHANNELS_URL}/deliveries/result`, result);
    } catch (e) {
        reportFailure("result", e);
    }
}

/** The ID of this browser profile, which the backend grants each frontend delivery to once. */
export function getProfileId() {
    profileIdPromise ??= readProfileId(globalThis.indexedDB, window.glob.documentIdHash);
    return profileIdPromise;
}

/**
 * Reads the profile ID that IndexedDB keeps for the database of `documentIdHash`, and creates it in
 * the transaction that reads it, so that tabs that start together get one ID. Resolves to
 * {@link FALLBACK_PROFILE_ID} where IndexedDB cannot be opened or the document ID hash is unknown.
 */
export async function readProfileId(
    factory: IDBFactory | undefined,
    documentIdHash: string | undefined
): Promise<string> {
    if (!factory || !documentIdHash) {
        return FALLBACK_PROFILE_ID;
    }

    try {
        return await readOrCreateProfileId(factory, `profile-${documentIdHash}`);
    } catch {
        return FALLBACK_PROFILE_ID;
    }
}

export async function listChannels() {
    return await request(() => server.getWithSilentErrors<NotificationChannelListResponse>(
        CHANNELS_URL));
}

export async function getReview(channelId: string) {
    return await request(() => server.getWithSilentErrors<NotificationChannelReview>(
        `${channelUrl(channelId)}/review`));
}

export async function enableChannel(channelId: string, body: NotificationChannelEnableRequest) {
    return await request(() => server.postWithSilentErrors<NotificationChannelSwitchResponse>(
        `${channelUrl(channelId)}/enable`, body));
}

/** Disables a channel. The route never refuses it. */
export async function disableChannel(channelId: string) {
    return await request(() => server.remove<NotificationChannelSwitchResponse>(
        `${channelUrl(channelId)}/enable`, undefined, undefined, SILENT_REFUSALS));
}

export async function changeSettings(channelId: string, body: NotificationChannelSettingsRequest) {
    await request(() => server.patch(
        `${channelUrl(channelId)}/settings`, body, undefined, SILENT_REFUSALS));
}

export async function createChannel(body: NotificationChannelCreateRequest) {
    return await request(() => server.postWithSilentErrors<NotificationChannelResponse>(
        CHANNELS_URL, body));
}

export async function editChannel(channelId: string, body: NotificationChannelEditRequest) {
    await request(() => server.patch(channelUrl(channelId), body, undefined, SILENT_REFUSALS));
}

export async function deleteChannel(channelId: string) {
    await request(() => server.remove(channelUrl(channelId), undefined, undefined,
        SILENT_REFUSALS));
}

/** The bundle of a script channel's `~configWidget` at the reviewed `revision`. */
export async function getConfigWidget(channelId: string, revision: string) {
    const query = `revision=${encodeURIComponent(revision)}`;
    const { bundle } = await request(() =>
        server.getWithSilentErrors<NotificationChannelConfigWidgetResponse>(
            `${channelUrl(channelId)}/config-widget?${query}`));
    return bundle;
}

export async function sendTestNotification(channelId: string) {
    return await request(() => server.postWithSilentErrors<NotificationChannelTestResponse>(
        `${channelUrl(channelId)}/test`));
}

/** Ends the pause of forwarding, and sends or skips what is still due. */
export async function resumeForwarding(sendDue: boolean) {
    const body: NotificationForwardingResumeRequest = { sendDue };
    await request(() => server.postWithSilentErrors(`${CHANNELS_URL}/resume`, body));
}

export async function getSecret(channelId: string) {
    return await request(() => server.getWithSilentErrors<NotificationChannelSecretView>(
        `${channelUrl(channelId)}/secret`));
}

export async function putSecret(
    channelId: string, body: NotificationChannelSecretPutRequest, credentials: Credentials
) {
    await request(() => server.withCredentials(
        "PUT", `${channelUrl(channelId)}/secret`, body, credentials, SILENT_REFUSALS));
}

export async function deleteSecret(
    channelId: string, body: NotificationChannelSecretDeleteRequest, credentials: Credentials
) {
    await request(() => server.withCredentials(
        "DELETE", `${channelUrl(channelId)}/secret`, body, credentials, SILENT_REFUSALS));
}

let profileIdPromise: Promise<string> | undefined;

/**
 * Runs a channel's bundle with the payload, the attempt and the channel's settings in its API, and
 * returns how long it ran and how it failed: `timeout` when its signal had aborted before it threw.
 */
async function runChannel(
    bundle: NotificationChannelBundle,
    payload: NotificationChannelPayload,
    { key, attempt, channelSettings }: {
        key: string;
        attempt: number;
        channelSettings: Record<string, string>;
    }
): Promise<Pick<NotificationDeliveryResultRequest, "durationMs" | "errorCode">> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    const startMs = performance.now();
    let isFailed = false;
    try {
        await executeBundleWithoutErrorHandling(bundle, null, undefined, {
            notification: payload,
            delivery: { key, attempt, signal: controller.signal },
            channelSettings
        });
    } catch {
        isFailed = true;
    } finally {
        clearTimeout(timer);
    }

    // The result route refuses a duration over the deadline of a delivery.
    const durationMs = Math.min(Math.round(performance.now() - startMs),
        NOTIFICATION_DELIVERY_DEADLINE_MS);
    if (!isFailed) {
        return { durationMs };
    }
    return { durationMs, errorCode: controller.signal.aborted ? "timeout" : "script-error" };
}

function readOrCreateProfileId(factory: IDBFactory, key: string) {
    return new Promise<string>((resolve, reject) => {
        const opening = factory.open(PROFILE_DATABASE, 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore(PROFILE_STORE);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
            const database = opening.result;
            const transaction = database.transaction(PROFILE_STORE, "readwrite");
            const store = transaction.objectStore(PROFILE_STORE);
            let profileId = "";

            const reading = store.get(key);
            reading.onsuccess = () => {
                if (typeof reading.result === "string" && reading.result) {
                    profileId = reading.result;
                } else {
                    profileId = randomString(PROFILE_ID_LENGTH);
                    store.add(profileId, key);
                }
            };

            // Resolves only after the commit: an ID whose write failed is not this profile's.
            transaction.oncomplete = () => {
                database.close();
                resolve(profileId);
            };
            const fail = () => {
                database.close();
                reject(transaction.error);
            };
            transaction.onerror = fail;
            transaction.onabort = fail;
        };
    });
}

/** Sends a request of the card, and throws a refusal as a {@link NotificationRequestError}. */
async function request<T>(send: () => Promise<T>): Promise<T> {
    try {
        return await send();
    } catch (e) {
        throw new NotificationRequestError(getErrorCode(e));
    }
}

function channelUrl(channelId: string) {
    return `${CHANNELS_URL}/${encodeURIComponent(channelId)}`;
}

/** Logs a failure by a fixed text and its code: nothing of a delivery reaches the log. */
function reportFailure(task: string, error: unknown) {
    logError(`A notification channel request failed: ${task}, ${getErrorCode(error)}.`);
}
