import { EntityChange } from "@triliumnext/commons";

export interface ExecutionContext {
    init<T>(fn: () => T): T;
    get<T = any>(key: string): T | undefined;
    set(key: string, value: any): void;
    reset(): void;
}

let ctx: ExecutionContext | null = null;

export function initContext(context: ExecutionContext) {
    if (ctx) throw new Error("Context already initialized");
    ctx = context;
}

export function getContext(): ExecutionContext {
    if (!ctx) throw new Error("Context not initialized");
    return ctx;
}

export function getHoistedNoteId() {
    return getContext().get("hoistedNoteId") || "root";
}


export function getComponentId() {
    return getContext().get("componentId");
}

export function isEntityEventsDisabled() {
    return !!getContext().get("disableEntityEvents");
}

export function disableEntityEvents() {
    getContext().set("disableEntityEvents", true);
}

export function enableEntityEvents() {
    getContext().set("disableEntityEvents", false);
}

export function setMigrationRunning(running: boolean) {
    getContext().set("migrationRunning", !!running);
}

export function isMigrationRunning() {
    return !!getContext().get("migrationRunning");
}

export function putEntityChange(entityChange: EntityChange) {
    if (getContext().get("ignoreEntityChangeIds")) {
        return;
    }

    const entityChangeIds = getContext().get("entityChangeIds") || [];

    // store only ID since the record can be modified (e.g., in erase)
    entityChangeIds.push(entityChange.id);

    getContext().set("entityChangeIds", entityChangeIds);
}
