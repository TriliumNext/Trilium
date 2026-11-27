import type {
    NotificationChannelListResponse, NotificationChannelReview, NotificationChannelSecretView,
    NotificationChannelView, NotificationForwardingState
} from "@triliumnext/commons";

/** A channel as the list route returns it: by default an enabled backend script. */
export function makeChannel(
    overrides: Partial<NotificationChannelView> = {}
): NotificationChannelView {
    return {
        channelId: "c1",
        kind: "script",
        title: "Channel",
        icon: "bx bx-broadcast",
        runsOn: "backend",
        state: "enabled",
        activationId: "a1",
        settings: { graceTime: 300, protectedNotes: "none" },
        settingsRecordIds: [],
        ...overrides
    };
}

/** A webhook as the list route returns it: by default found, its address bound to its template. */
export function makeWebhook(overrides: Partial<NotificationChannelView> = {}) {
    return makeChannel({
        channelId: "w1",
        kind: "built-in",
        type: "webhook",
        title: "Webhook",
        icon: "bx bx-link",
        state: "found",
        activationId: undefined,
        config: { template: "" },
        isAddressSet: true,
        isTemplateBound: true,
        ...overrides
    });
}

/** The forwarding of an instance without a sync server, with nothing that stops it. */
export function makeForwarding(
    overrides: Partial<NotificationForwardingState> = {}
): NotificationForwardingState {
    return {
        isForwardingInstance: true,
        off: null,
        pause: null,
        isRecordReadable: true,
        recordName: "notification-deliveries.json",
        runsBackendScripts: true,
        ...overrides
    };
}

export function makeList(
    channels: NotificationChannelView[],
    forwarding: Partial<NotificationForwardingState> = {},
    isWebhookAvailable = true
): NotificationChannelListResponse {
    return {
        channels,
        forwarding: makeForwarding(forwarding),
        types: [ {
            type: "webhook", title: "Webhook", icon: "bx bx-link", isAvailable: isWebhookAvailable
        } ]
    };
}

export function makeReview(
    overrides: Partial<NotificationChannelReview> = {}
): NotificationChannelReview {
    return {
        revision: "r1",
        runsOn: "backend",
        text: "Note c1 \"Channel\"\n#notificationChannel\napi.log(api.notification.title);",
        isRunnable: true,
        forwardingRunsBackendScripts: true,
        hasConfigWidget: false,
        ...overrides
    };
}

/** The secret view of a webhook whose address is set. */
export function makeSecret(
    overrides: Partial<NotificationChannelSecretView> = {}
): NotificationChannelSecretView {
    return {
        isSet: true,
        version: 3,
        label: "ntfy on the NAS",
        headers: [ "Authorization" ],
        values: [ "token" ],
        hasSigningSecret: false,
        network: { allowPrivate: false, allowLoopback: false },
        changedAt: "2026-11-27 10:00:00.000Z",
        templateHash: "",
        isNetworkAllowed: true,
        ...overrides
    };
}
