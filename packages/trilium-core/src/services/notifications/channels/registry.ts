/**
 * @module
 *
 * The built-in types of channel. Internal code registers a type, and a Node-only type registers
 * a loader, so that its code loads only when the channels start. Scripts have no access here.
 */
import { NotificationError } from "../model.js";
import { ChannelSendError, type NotificationChannelType } from "./types.js";

export type ChannelTypeLoader = () => Promise<NotificationChannelType[]>;

/**
 * The webhook where no host registers it: in standalone and on mobile the page's `fetch` cannot
 * keep to its policy, so the type is listed and not available.
 */
const UNAVAILABLE_WEBHOOK: NotificationChannelType = {
    type: "webhook",
    title: "Webhook",
    icon: "bx bx-link-external",
    isAvailable: () => false,
    checkConfig: () => {
        throw new NotificationError("type-unavailable");
    },
    getAddressState: () => null,
    send: () => Promise.reject(new ChannelSendError("policy"))
};

const types = new Map<string, NotificationChannelType>([
    [ UNAVAILABLE_WEBHOOK.type, UNAVAILABLE_WEBHOOK ]
]);
const loaders: ChannelTypeLoader[] = [];
const addressListeners = new Set<(channelId: string) => void>();
let loading: Promise<void> | null = null;

export function registerChannelType(type: NotificationChannelType) {
    types.set(type.type, type);
}

/** Registers types that load on the first `loadChannelTypes()`. */
export function registerChannelTypeLoader(loader: ChannelTypeLoader) {
    loaders.push(loader);
}

/** Loads the types of every registered loader. Concurrent callers share one load. */
export function loadChannelTypes(): Promise<void> {
    loading ??= (async () => {
        while (loaders.length > 0) {
            const loader = loaders.shift();
            for (const type of loader ? await loader() : []) {
                registerChannelType(type);
            }
        }
        loading = null;
    })();
    return loading;
}

export function getChannelType(type: string): NotificationChannelType | null {
    return types.get(type) ?? null;
}

export function getChannelTypes(): NotificationChannelType[] {
    return [ ...types.values() ];
}

/**
 * Tells the channels that the address of a built-in channel changed on this instance, so that its
 * `channel` record follows the host's file and the deliveries queued for the old address end.
 */
export function notifyAddressChanged(channelId: string) {
    for (const listener of addressListeners) {
        listener(channelId);
    }
}

/** @returns a function that removes the listener. */
export function onAddressChanged(listener: (channelId: string) => void) {
    addressListeners.add(listener);
    return () => addressListeners.delete(listener);
}

/** Forgets every type and loader but the unavailable webhook, for specs. */
export function clearChannelTypes() {
    types.clear();
    types.set(UNAVAILABLE_WEBHOOK.type, UNAVAILABLE_WEBHOOK);
    loaders.length = 0;
    loading = null;
}
