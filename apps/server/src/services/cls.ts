import type { EntityChange } from "@triliumnext/commons";
import { cls } from "@triliumnext/core";

type Callback = (...args: any[]) => any;

function init<T>(callback: () => T) {
    return cls.getContext().init(callback);
}

function wrap(callback: Callback) {
    return () => {
        try {
            init(callback);
        } catch (e: any) {
            console.log(`Error occurred: ${e.message}: ${e.stack}`);
        }
    };
}

function getHoistedNoteId() {
    return cls.getHoistedNoteId();
}

function getComponentId() {
    return cls.getComponentId();
}

/** @deprecated */
function disableEntityEvents() {
    cls.disableEntityEvents();
}

/** @deprecated */
function enableEntityEvents() {
    cls.enableEntityEvents();
}

function isEntityEventsDisabled() {
    return cls.isEntityEventsDisabled();
}

/** @deprecated */
function setMigrationRunning(running: boolean) {
    cls.setMigrationRunning(running);
}

/** @deprecated */
function isMigrationRunning() {
    return cls.isMigrationRunning();
}

function getAndClearEntityChangeIds() {
    const entityChangeIds = cls.getContext().get("entityChangeIds") || [];

    cls.getContext().set("entityChangeIds", []);

    return entityChangeIds;
}

function putEntityChange(entityChange: EntityChange) {
    cls.putEntityChange(entityChange);
}

function ignoreEntityChangeIds() {
    cls.getContext().set("ignoreEntityChangeIds", true);
}

function get(key: string) {
    return cls.getContext().get(key);
}

function set(key: string, value: unknown) {
    cls.getContext().set(key, value);
}

function reset() {
    cls.getContext().reset();
}

export default {
    init,
    wrap,
    get,
    set,
    getHoistedNoteId,
    getComponentId,
    disableEntityEvents,
    enableEntityEvents,
    isEntityEventsDisabled,
    reset,
    getAndClearEntityChangeIds,
    putEntityChange,
    ignoreEntityChangeIds,
    setMigrationRunning,
    isMigrationRunning
};
