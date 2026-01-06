import log, { getLog } from "./log.js";

const NOTE_TITLE_CHANGED = "NOTE_TITLE_CHANGED";
const ENTER_PROTECTED_SESSION = "ENTER_PROTECTED_SESSION";
const LEAVE_PROTECTED_SESSION = "LEAVE_PROTECTED_SESSION";
const ENTITY_CREATED = "ENTITY_CREATED";
const ENTITY_CHANGED = "ENTITY_CHANGED";
const ENTITY_DELETED = "ENTITY_DELETED";
const ENTITY_CHANGE_SYNCED = "ENTITY_CHANGE_SYNCED";
const ENTITY_DELETE_SYNCED = "ENTITY_DELETE_SYNCED";
const CHILD_NOTE_CREATED = "CHILD_NOTE_CREATED";
const NOTE_CONTENT_CHANGE = "NOTE_CONTENT_CHANGED";
const DB_INITIALIZED = "DB_INITIALIZED";

type EventType = string | string[];
type EventListener = (data: any) => void;

const eventListeners: Record<string, EventListener[]> = {};

/**
 * @param eventTypes - can be either single event or an array of events
 */
function subscribe(eventTypes: EventType, listener: EventListener) {
    if (!Array.isArray(eventTypes)) {
        eventTypes = [eventTypes];
    }

    for (const eventType of eventTypes) {
        eventListeners[eventType] = eventListeners[eventType] || [];
        eventListeners[eventType].push(listener);
    }
}

function subscribeBeccaLoader(eventTypes: EventType, listener: EventListener) {
    if (!Array.isArray(eventTypes)) {
        eventTypes = [eventTypes];
    }

    for (const eventType of eventTypes) {
        eventListeners[eventType] = eventListeners[eventType] || [];
        // becca loader should be the first listener so that other listeners can already work
        // with updated becca
        eventListeners[eventType] = [listener, ...eventListeners[eventType]];
    }
}

function emit(eventType: string, data?: any) {
    const listeners = eventListeners[eventType];

    if (listeners) {
        for (const listener of listeners) {
            try {
                listener(data);
            } catch (e: any) {
                getLog().error(`Listener threw error: ${e.message}, stack: ${e.stack}`);
                // we won't stop execution because of listener
            }
        }
    }
}

export default {
    subscribe,
    subscribeBeccaLoader,
    emit,
    // event types:
    NOTE_TITLE_CHANGED,
    ENTER_PROTECTED_SESSION,
    LEAVE_PROTECTED_SESSION,
    ENTITY_CREATED,
    ENTITY_CHANGED,
    ENTITY_DELETED,
    ENTITY_CHANGE_SYNCED,
    ENTITY_DELETE_SYNCED,
    CHILD_NOTE_CREATED,
    NOTE_CONTENT_CHANGE,
    DB_INITIALIZED
};
