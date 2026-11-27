/**
 * @module
 *
 * The notification service of this database with its adapters, and the built-in notices of the
 * security records.
 */
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@triliumnext/commons";
import { t } from "i18next";

import { getLog } from "../log.js";
import { getMessagingProvider } from "../messaging/index.js";
import optionService from "../options.js";
import { getLastSyncedBatchTime } from "../sync_update.js";
import ws from "../ws.js";
import { DeliveryRecord, MemoryRecordPort } from "./channels/delivery_record.js";
import NotificationForwarder, {
    type ChannelNotice, getEntityChangeMark
} from "./channels/forwarder.js";
import type { DeliveryRecordPort } from "./channels/types.js";
import { NotificationError } from "./model.js";
import NotificationService, { type NotificationProducer } from "./service.js";
import * as store from "./store.js";

const SECURITY_PRODUCER: NotificationProducer = { kind: "built-in", name: "trilium:security" };
const CHANNELS_PRODUCER: NotificationProducer = { kind: "built-in", name: "trilium:notifications" };
const SIGN_IN_SETTINGS_LINK = "#root/_hidden/_options/_optionsPassword";
const STARTUP_REPAIR_ID = "trilium:security:startup-repair";
const WRONG_CODES_ID = "trilium:security:wrong-codes";
/** The notice of wrong codes is raised at most once in this time. */
const WRONG_CODES_INTERVAL_MS = 60 * 60 * 1000;

let service: NotificationService | null = null;
let forwarder: NotificationForwarder | null = null;
let recordPort: DeliveryRecordPort = new MemoryRecordPort();

/** The service of this database, made at its first use: its modules import in a cycle. */
export function getNotificationService() {
    service ??= new NotificationService({
        store,
        transport: { send: (message) => ws.sendMessageToAllClients(message) },
        settings: { isCategoryOff: (category) => getDisabledCategories().includes(category) },
        getLastSyncedBatchTime: () => getLastSyncedBatchTime()
    });
    return service;
}

/** Sets where the delivery record is kept. A host calls it before `startNotifications()`. */
export function initDeliveryRecordPort(port: DeliveryRecordPort) {
    recordPort = port;
}

/** The forwarder of the channels of this database, made at its first use. */
export function getNotificationForwarder() {
    forwarder ??= new NotificationForwarder({
        record: new DeliveryRecord(recordPort, getEntityChangeMark),
        transport: {
            send: (message) => ws.sendMessageToAllClients(message),
            getClientCount: () => getMessagingProvider().getClientCount?.() ?? 1
        },
        notices: {
            raise: raiseChannelNotice,
            dismiss: (id) => getNotificationService().dismissById(id),
            isShown: (id) => getNotificationService().getById(id) !== null,
            getNewestTime: (id) => store.getNewestKnownTime(id)
        },
        getLastSyncedBatchTime: () => getLastSyncedBatchTime()
    });
    return forwarder;
}

/** Starts the service and the forwarder, once Becca has loaded. */
export function startNotifications() {
    getNotificationService().start();
    void getNotificationForwarder().start().catch(() => {
        getLog().error("The notification channels could not start: internal.");
    });
}

/** Raises the notice of the device options that a start or a reader of a time put back. */
export function raiseStartupRepairNotice(names: string[]) {
    raiseSecurityNotice({
        id: STARTUP_REPAIR_ID,
        title: t("notifications.startup-repair-title"),
        description: t("notifications.startup-repair-description", { names: names.join(", ") })
    });
}

/** Raises the notice of wrong codes of the second factor, at most once an hour. */
export function raiseWrongCodeNotice(count: number) {
    const newestMs = store.getNewestKnownTime(WRONG_CODES_ID);
    if (newestMs !== null && Date.now() - newestMs < WRONG_CODES_INTERVAL_MS) {
        return;
    }

    raiseSecurityNotice({
        id: WRONG_CODES_ID,
        title: t("notifications.wrong-codes-title"),
        description: t("notifications.wrong-codes-description", { count })
    });
}

function raiseSecurityNotice(notice: { id: string; title: string; description: string }) {
    try {
        getNotificationService().create({
            ...notice,
            category: "general",
            type: "standard",
            attentionLevel: "high",
            icon: "bx bx-shield-quarter",
            link: SIGN_IN_SETTINGS_LINK
        }, SECURITY_PRODUCER);
    } catch (e) {
        const code = e instanceof NotificationError ? e.code : "internal";
        getLog().error(`Could not raise the notice ${notice.id}: ${code}.`);
    }
}

/** Raises the notice of a channel that stops, or of forwarding that pauses. It is never forwarded. */
function raiseChannelNotice(notice: ChannelNotice) {
    try {
        getNotificationService().create({
            ...notice,
            category: "general",
            type: "standard",
            attentionLevel: "medium",
            icon: "bx bx-broadcast"
        }, CHANNELS_PRODUCER);
    } catch (e) {
        const code = e instanceof NotificationError ? e.code : "internal";
        getLog().error(`Could not raise the notice ${notice.id}: ${code}.`);
    }
}

/** The categories that the synced option turns off. A value that does not parse turns none off. */
function getDisabledCategories(): NotificationCategory[] {
    try {
        const value: unknown = JSON.parse(
            optionService.getOptionOrNull("notificationDisabledCategories") || "[]");
        return Array.isArray(value)
            ? NOTIFICATION_CATEGORIES.filter((category) => value.includes(category))
            : [];
    } catch {
        return [];
    }
}
