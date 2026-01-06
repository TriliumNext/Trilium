import type { EntityChange } from "@triliumnext/commons";
import { getContext, getHoistedNoteId as getHoistedNoteIdInternal } from "@triliumnext/core/src/services/context";

type Callback = (...args: any[]) => any;

function init<T>(callback: () => T) {
    return getContext().init(callback);
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
    return getHoistedNoteIdInternal();
}

function getComponentId() {
    return getContext().get("componentId");
}

function disableEntityEvents() {
    getContext().set("disableEntityEvents", true);
}

function enableEntityEvents() {
    getContext().set("disableEntityEvents", false);
}

function isEntityEventsDisabled() {
    return !!getContext().get("disableEntityEvents");
}

function setMigrationRunning(running: boolean) {
    getContext().set("migrationRunning", !!running);
}

function isMigrationRunning() {
    return !!getContext().get("migrationRunning");
}

function getAndClearEntityChangeIds() {
    const entityChangeIds = getContext().get("entityChangeIds") || [];

    getContext().set("entityChangeIds", []);

    return entityChangeIds;
}

function putEntityChange(entityChange: EntityChange) {
    if (getContext().get("ignoreEntityChangeIds")) {
        return;
    }

    const entityChangeIds = getContext().get("entityChangeIds") || [];

    // store only ID since the record can be modified (e.g., in erase)
    entityChangeIds.push(entityChange.id);

    getContext().set("entityChangeIds", entityChangeIds);
}

function ignoreEntityChangeIds() {
    getContext().set("ignoreEntityChangeIds", true);
}

function get(key: string) {
    return getContext().get(key);
}

function set(key: string, value: unknown) {
    getContext().set(key, value);
}

function reset() {
    getContext().reset();
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
