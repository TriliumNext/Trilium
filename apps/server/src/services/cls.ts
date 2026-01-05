import type { EntityChange } from "@triliumnext/commons";
import { getContext } from "@triliumnext/core/src/services/context";

type Callback = (...args: any[]) => any;

function init(callback: () => void) {
    getContext().init(callback);
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
    return getContext().get("hoistedNoteId") || "root";
}

function getComponentId() {
    return getContext().get("componentId");
}

function getLocalNowDateTime() {
    return getContext().get("localNowDateTime");
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
    getLocalNowDateTime,
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
