import type { EntityChange } from "@triliumnext/commons";
import { cls } from "@triliumnext/core";

function init<T>(callback: () => T) {
    return cls.getContext().init(callback);
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

/** @deprecated */
function getAndClearEntityChangeIds() {
    return cls.getAndClearEntityChangeIds();
}

function putEntityChange(entityChange: EntityChange) {
    cls.putEntityChange(entityChange);
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

/** @deprecated */
export const wrap = cls.wrap;
/** @deprecated */
export const ignoreEntityChangeIds = cls.ignoreEntityChangeIds;

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
