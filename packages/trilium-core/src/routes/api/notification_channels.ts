/**
 * @module
 *
 * The routes of the channels that forward notifications. Like the notification routes, a refusal
 * answers its code alone, and every route refuses on a database that has not opened. No answer
 * holds any part of a webhook's address: that is the secret route of the server.
 */
import {
    BUILTIN_ATTRIBUTES,
    DEFAULT_NOTIFICATION_CHANNEL_SETTINGS,
    NOTIFICATION_CHANNEL_LABEL_MAX_BYTES,
    NOTIFICATION_CHANNEL_MAX_LABELS,
    NOTIFICATION_DELIVERY_DEADLINE_MS,
    NOTIFICATION_DELIVERY_ERROR_CODES,
    type NotificationChannelListResponse,
    type NotificationChannelReview,
    type NotificationChannelSwitchResponse,
    type NotificationChannelTestResponse,
    type NotificationChannelView,
    type NotificationDeliveryErrorCode
} from "@triliumnext/commons";
import { t } from "i18next";

import type { Request } from "../../http_interface";
import * as cls from "../../services/context.js";
import { getPlatform } from "../../services/platform.js";
import { hashTemplate } from "../../services/notifications/channels/body_template.js";
import {
    type Channel,
    getChannel,
    getChannels,
    getChannelState,
    getCurrentRevision,
    getLiveActivation
} from "../../services/notifications/channels/catalog.js";
import {
    getChannelsOff,
    isForwardingInstance
} from "../../services/notifications/channels/forwarder.js";
import * as ledger from "../../services/notifications/channels/ledger.js";
import {
    getActivation,
    getDefinition,
    getHeldSettings,
    getRecords,
    getStatus,
    writeActivation,
    writeDefinition,
    writeRevocation,
    writeSettingsRecord
} from "../../services/notifications/channels/records.js";
import { getChannelType, getChannelTypes } from "../../services/notifications/channels/registry.js";
import {
    diffAttributes,
    formatReviewText,
    getFrontendBundle
} from "../../services/notifications/channels/script_channels.js";
import { getNotificationForwarder } from "../../services/notifications/index.js";
import {
    type ActivationRecord,
    CHANNEL_RECORD_MAX_BYTES,
    isToken,
    NotificationError,
    parseSettings
} from "../../services/notifications/model.js";
import { isScriptingEnabled } from "../../services/scripting_guard.js";
import { getSql } from "../../services/sql/index.js";
import { encodeUtf8 } from "../../services/utils/binary.js";
import { newEntityId } from "../../services/utils/index.js";
import { answer, answerAsync, refuse } from "./notifications.js";

/** The name of a label that a channel's settings widget writes. */
const LABEL_NAME = /^[A-Za-z0-9_]{1,64}$/;
const BUILT_IN_NAMES = new Set(BUILTIN_ATTRIBUTES.map(({ name }) => name));
/** A delivery key: the base64url of an HMAC-SHA256. */
const DELIVERY_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const TITLE_MAX_LENGTH = 200;

function listChannels() {
    return answer((): NotificationChannelListResponse => {
        const forwarder = getNotificationForwarder();
        const causes = forwarder.getPauseCauses();
        const sinceMs = forwarder.getPauseSince();
        return {
            channels: getChannels().map(toView),
            forwarding: {
                isForwardingInstance: isForwardingInstance(),
                off: getChannelsOff(),
                pause: causes.length > 0 && sinceMs !== null
                    ? { causes, since: new Date(sinceMs).toISOString() }
                    : null,
                isRecordReadable: !!forwarder.record.getState(),
                recordName: forwarder.record.name,
                runsBackendScripts: isScriptingEnabled()
            },
            types: getChannelTypes().map((type) => ({
                type: type.type,
                title: t(`notifications.channel-type-${type.type}`,
                    { defaultValue: type.title }) as string,
                icon: type.icon,
                isAvailable: type.isAvailable()
            }))
        };
    });
}

/** `{ type, title, config? }`: a built-in channel. */
function createChannel(req: Request) {
    return answer(() => {
        const { type: typeName, title, config } = req.body ?? {};
        const type = typeof typeName === "string" ? getChannelType(typeName) : null;
        if (!type) {
            return refuse("not-found");
        }
        if (!type.isAvailable()) {
            return refuse("type-unavailable");
        }
        const channelId = newEntityId();
        writeDefinition(channelId, {
            v: 1, type: type.type, title: checkTitle(title), config: type.checkConfig(config ?? {})
        });
        return { channel: toView(getChannelOrThrow(channelId)) };
    });
}

/** `{ title?, config? }`: edits a built-in channel. */
function editChannel(req: Request<{ channelId: string }>) {
    return answer(() => {
        const definition = getDefinition(req.params.channelId);
        const type = definition ? getChannelType(definition.type) : null;
        if (!definition || definition.isDeleted) {
            return refuse("not-found");
        }
        const { title, config } = req.body ?? {};
        writeDefinition(req.params.channelId, {
            ...definition,
            title: title === undefined ? definition.title : checkTitle(title),
            config: config === undefined ? definition.config : checkConfig(type, config)
        });
        return { channel: toView(getChannelOrThrow(req.params.channelId)) };
    });
}

/** Deletes a built-in channel, which disables it first. */
function deleteChannel(req: Request<{ channelId: string }>) {
    return answerAsync(async () => {
        const { channelId } = req.params;
        const definition = getDefinition(channelId);
        if (!definition || definition.isDeleted) {
            return refuse("not-found");
        }
        await getNotificationForwarder().switchOff(channelId, (sequence) =>
            writeDisabling(channelId, sequence));
        cls.init(() => getSql().transactional(() =>
            writeDefinition(channelId, { ...definition, isDeleted: true })));
        return undefined;
    });
}

/** What enabling the channel would run, as text, with its revision. */
function getReview(req: Request<{ channelId: string }>) {
    return answer((): NotificationChannelReview => {
        const channel = getChannelOrThrow(req.params.channelId);
        const current = getCurrentRevision(channel);
        const activation = getActivation(channel.channelId);
        const review: NotificationChannelReview = {
            revision: current.revision ?? "",
            runsOn: channel.runsOn,
            text: current.collected
                ? formatReviewText(current.collected.record)
                : JSON.stringify(channel.definition?.config ?? {}, null, 4),
            isRunnable: current.revision !== null,
            forwardingRunsBackendScripts: getForwardingRunsBackendScripts(),
            hasConfigWidget: !!current.collected?.record.configWidget
        };
        if (current.collected && activation?.restRevision === current.collected.restRevision
            && activation.ownedAttributes) {
            review.changes = diffAttributes(activation.ownedAttributes,
                current.collected.ownedAttributes);
        }
        return review;
    });
}

/**
 * `{ revision, graceTime, protectedNotes, labels? }`: enables the reviewed revision. The labels of
 * a script's widget are written as owned labels of the channel note, and the activation takes the
 * revision that they make, in one transaction after the record took the switching.
 */
function enableChannel(req: Request<{ channelId: string }>) {
    return answerAsync(async (): Promise<NotificationChannelSwitchResponse> => {
        const { channelId } = req.params;
        const { revision, graceTime, protectedNotes, labels } = req.body ?? {};
        const settings = parseSettings({ graceTime, protectedNotes });
        const checkedLabels = checkLabels(labels);
        if (!isToken(revision) || !settings) {
            throw new NotificationError("invalid-input");
        }
        const channel = getChannelOrThrow(channelId);
        if (channel.kind === "built-in" && !channel.type?.isAvailable()) {
            throw new NotificationError("type-unavailable");
        }
        if (channel.kind === "built-in" && checkedLabels.length > 0) {
            throw new NotificationError("invalid-input");
        }
        const current = getCurrentRevision(channel);
        if (current.revision === null) {
            throw new NotificationError("not-runnable");
        }
        if (current.revision !== revision) {
            throw new NotificationError("stale-revision");
        }
        checkActivationSize(current.collected?.ownedAttributes ?? [], checkedLabels);

        const isRecorded = await getNotificationForwarder().switchOn(channelId,
            (activationId, sequence) => {
                writeActivation(channelId, buildActivation(channelId, revision, activationId,
                    sequence, settings, checkedLabels));
            });
        return { channel: toView(getChannelOrThrow(channelId)), isRecorded };
    });
}

/** Disables the channel. Never refused. */
function disableChannel(req: Request<{ channelId: string }>) {
    return answerAsync(async (): Promise<NotificationChannelSwitchResponse> => {
        const { channelId } = req.params;
        if (!isToken(channelId)) {
            throw new NotificationError("invalid-input");
        }
        const isRecorded = await getNotificationForwarder().switchOff(channelId, (sequence) =>
            writeDisabling(channelId, sequence));
        const channel = getChannel(channelId);
        if (!channel) {
            throw new NotificationError("not-found");
        }
        return { channel: toView(channel), isRecorded };
    });
}

/** `{ graceTime?, protectedNotes?, expected }`: a settings record of the current activation. */
function changeSettings(req: Request<{ channelId: string }>) {
    return answer(() => {
        const { channelId } = req.params;
        const { graceTime, protectedNotes, expected } = req.body ?? {};
        const held = getHeldSettings(channelId);
        if (!held || !isExpected(expected, held.activationId, held.currentRecordIds)) {
            return refuse("stale-revision");
        }
        const settings = parseSettings({
            graceTime: graceTime ?? held.settings.graceTime,
            protectedNotes: protectedNotes ?? held.settings.protectedNotes
        });
        if (!settings) {
            return refuse("invalid-input");
        }
        getNotificationForwarder().checkSettingsRate(held.activationId);
        writeSettingsRecord(channelId, {
            v: 1, activationId: held.activationId, settings, reads: held.currentRecordIds
        });
        return { channel: toView(getChannelOrThrow(channelId)) };
    });
}

/** `?revision=`: the bundle of a script channel's settings widget at its current revision. */
function getConfigWidget(req: Request<{ channelId: string }, { revision?: string }>) {
    return answer(() => {
        if (getPlatform().getEnv("TRILIUM_SAFE_MODE")) {
            return refuse("safe-mode");
        }
        const channel = getChannelOrThrow(req.params.channelId);
        const current = getCurrentRevision(channel);
        if (current.revision === null || current.revision !== req.query.revision) {
            return refuse("stale-revision");
        }
        const bundle = current.collected
            ? getFrontendBundle(current.collected, "configWidget")
            : null;
        return bundle ? { bundle } : refuse("not-found");
    });
}

/** A test send. It answers with status 200 whatever the channel did. */
function testChannel(req: Request<{ channelId: string }>) {
    return answerAsync(async (): Promise<NotificationChannelTestResponse> => {
        getChannelOrThrow(req.params.channelId);
        return await getNotificationForwarder().sendTest(req.params.channelId) as
            NotificationChannelTestResponse;
    });
}

/** `{ sendDue }`: ends the pause of forwarding, and sends or skips what is still due. */
function resumeForwarding(req: Request) {
    return answerAsync(async () => {
        const { sendDue } = req.body ?? {};
        if (typeof sendDue !== "boolean") {
            throw new NotificationError("invalid-input");
        }
        await getNotificationForwarder().resume(sendDue);
        return undefined;
    });
}

/** `{ deliveryKey, profileId }`: a tab asks to run a frontend channel. */
function claimDelivery(req: Request) {
    return answerAsync(async () => {
        const { deliveryKey, profileId } = req.body ?? {};
        if (!isDeliveryKey(deliveryKey) || !isToken(profileId)) {
            throw new NotificationError("invalid-input");
        }
        return await getNotificationForwarder().claim(deliveryKey, profileId);
    });
}

/** `{ deliveryKey, profileId, durationMs, errorCode? }`: the outcome of a granted run. */
function reportDeliveryResult(req: Request) {
    return answer(() => {
        const { deliveryKey, profileId, durationMs, errorCode } = req.body ?? {};
        const isErrorCode = errorCode === undefined
            || (NOTIFICATION_DELIVERY_ERROR_CODES as readonly unknown[]).includes(errorCode);
        if (!isDeliveryKey(deliveryKey) || !isToken(profileId) || !Number.isSafeInteger(durationMs)
            || durationMs < 0 || durationMs > NOTIFICATION_DELIVERY_DEADLINE_MS || !isErrorCode) {
            return refuse("invalid-input");
        }
        getNotificationForwarder().reportResult(deliveryKey, profileId,
            errorCode as NotificationDeliveryErrorCode | undefined);
        return undefined;
    });
}

/** A channel as the list gives it, without any part of an address. */
function toView(channel: Channel): NotificationChannelView {
    const { channelId } = channel;
    const forwarder = getNotificationForwarder();
    const activation = getLiveActivation(channelId);
    const current = getCurrentRevision(channel);
    const held = getHeldSettings(channelId);
    const view: NotificationChannelView = {
        channelId,
        kind: channel.kind,
        title: channel.title,
        icon: channel.icon,
        runsOn: channel.runsOn,
        state: getChannelState(activation, current),
        settings: held?.settings ?? activation?.settings ?? DEFAULT_NOTIFICATION_CHANNEL_SETTINGS,
        settingsRecordIds: held?.currentRecordIds ?? []
    };
    if (channel.definition) {
        view.type = channel.definition.type;
        view.config = channel.definition.config;
        view.isAddressSet = !!channel.definition.configurationId;
    }
    if (activation?.activationId) {
        view.activationId = activation.activationId;
        view.recordHold = forwarder.getRecordHold(channelId, activation.activationId);
    }
    const status = getStatus(channelId);
    if (status && channel.runsOn === "backend") {
        view.status = status;
    }
    if (channel.runsOn === "frontend") {
        view.localCounts = {
            ...ledger.countDeliveries(channelId),
            waitingForBudget: forwarder.getWaitingForBudget(channelId)
        };
    }
    if (current.revision === null) {
        view.isNotRunnable = true;
    }
    if (current.collected?.record.configWidget) {
        view.hasConfigWidget = true;
    }
    const address = isForwardingInstance() ? channel.type?.getAddressState(channelId) : null;
    if (address) {
        view.isTemplateBound = hashTemplate(channel.definition?.config.template)
            === address.templateHash;
    }
    return view;
}

/**
 * The `activation` record of an enabling, with the labels of a script's widget written.
 *
 * @throws NotificationError `stale-revision` when the channel is no longer at `reviewedRevision`.
 */
function buildActivation(
    channelId: string,
    reviewedRevision: string,
    activationId: string,
    sequence: number,
    settings: NonNullable<ReturnType<typeof parseSettings>>,
    labels: [ string, string ][]
): ActivationRecord {
    const channel = getChannelOrThrow(channelId);
    const { revision } = getCurrentRevision(channel);
    if (revision === null) {
        throw new NotificationError("not-runnable");
    }
    if (revision !== reviewedRevision) {
        throw new NotificationError("stale-revision");
    }
    if (channel.script) {
        for (const [ name, value ] of labels) {
            channel.script.note.setLabel(name, value);
        }
    }

    const fresh = getChannelOrThrow(channelId);
    const current = getCurrentRevision(fresh);
    if (current.revision === null) {
        throw new NotificationError("not-runnable");
    }
    const activation: ActivationRecord = {
        v: 1, activationId, sequence, revision: current.revision, settings
    };
    if (current.collected && fresh.script) {
        const { attributeId, utcDateModified } = fresh.script.label;
        activation.restRevision = current.collected.restRevision;
        if (utcDateModified) {
            activation.label = { attributeId, utcDateModified };
        }
        activation.ownedAttributes = current.collected.ownedAttributes;
    }
    if (encodeUtf8(JSON.stringify(activation)).byteLength > CHANNEL_RECORD_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
    return activation;
}

/** Clears the activation of a channel with the next sequence, and revokes the one it held. */
function writeDisabling(channelId: string, sequence: number) {
    const activation = getActivation(channelId);
    writeActivation(channelId, {
        v: 1,
        activationId: null,
        sequence,
        revision: null,
        settings: activation?.settings ?? DEFAULT_NOTIFICATION_CHANNEL_SETTINGS
    });
    if (activation?.activationId) {
        writeRevocation(channelId, activation.activationId);
    }
}

/**
 * Checks the labels of a script's widget: at most 20, each at most 1 KiB, named with ASCII
 * letters, digits and `_`, and no name that the built-in attributes have.
 *
 * @throws NotificationError `invalid-input`.
 */
function checkLabels(labels: unknown): [ string, string ][] {
    if (labels === undefined) {
        return [];
    }
    if (typeof labels !== "object" || labels === null || Array.isArray(labels)) {
        throw new NotificationError("invalid-input");
    }
    const entries = Object.entries(labels);
    if (entries.length > NOTIFICATION_CHANNEL_MAX_LABELS || !entries.every(([ name, value ]) =>
        LABEL_NAME.test(name) && !BUILT_IN_NAMES.has(name) && typeof value === "string"
        && encodeUtf8(value).byteLength <= NOTIFICATION_CHANNEL_LABEL_MAX_BYTES)) {
        throw new NotificationError("invalid-input");
    }
    return entries as [ string, string ][];
}

/**
 * Refuses an enabling whose `activation` record would hold more than 32 KiB, before the record
 * of deliveries takes its switching.
 */
function checkActivationSize(
    ownedAttributes: { type: string; name: string; value: string }[],
    labels: [ string, string ][]
) {
    const estimate = JSON.stringify({ ownedAttributes, labels, padding: "x".repeat(1024) });
    if (encodeUtf8(estimate).byteLength > CHANNEL_RECORD_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
}

function checkTitle(title: unknown) {
    if (typeof title !== "string" || !title.trim() || title.length > TITLE_MAX_LENGTH
        || /[\u{0}-\u{1F}\u{7F}-\u{9F}]/u.test(title)) {
        throw new NotificationError("invalid-input");
    }
    return title;
}

function checkConfig(type: ReturnType<typeof getChannelType>, config: unknown) {
    if (!type) {
        throw new NotificationError("type-unavailable");
    }
    return type.checkConfig(config);
}

function isExpected(expected: unknown, activationId: string, recordIds: string[]) {
    if (typeof expected !== "object" || expected === null) {
        return false;
    }
    const { activationId: expectedId, recordIds: expectedIds } =
        expected as { activationId?: unknown; recordIds?: unknown };
    return expectedId === activationId && Array.isArray(expectedIds)
        && expectedIds.length === recordIds.length
        && [ ...expectedIds ].sort().every((recordId, index) => recordId === recordIds[index]);
}

/**
 * Whether the forwarding instance runs backend scripts: this instance's switch where it forwards,
 * else what a status record of the forwarding instance says, `null` without one.
 */
function getForwardingRunsBackendScripts() {
    if (isForwardingInstance()) {
        return isScriptingEnabled();
    }
    const statuses = getRecords("status");
    return statuses.length > 0 ? statuses[0].content.status.runsBackendScripts : null;
}

function getChannelOrThrow(channelId: string) {
    const channel = isToken(channelId) ? getChannel(channelId) : null;
    if (!channel) {
        throw new NotificationError("not-found");
    }
    return channel;
}

function isDeliveryKey(value: unknown): value is string {
    return typeof value === "string" && DELIVERY_KEY.test(value);
}

export default {
    listChannels,
    createChannel,
    editChannel,
    deleteChannel,
    getReview,
    enableChannel,
    disableChannel,
    changeSettings,
    getConfigWidget,
    testChannel,
    resumeForwarding,
    claimDelivery,
    reportDeliveryResult
};
