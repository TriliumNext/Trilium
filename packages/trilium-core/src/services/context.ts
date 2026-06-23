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

export function wrap(callback: (...args: any[]) => any) {
    return () => {
        try {
            getContext().init(callback);
        } catch (e: any) {
            console.log(`Error occurred: ${e.message}: ${e.stack}`);
        }
    };
}

export function init<T>(callback: () => T): T {
    return getContext().init(callback);
}

export function get<T = any>(key: string): T | undefined {
    return getContext().get<T>(key);
}

export function set(key: string, value: unknown): void {
    getContext().set(key, value);
}

export function reset(): void {
    getContext().reset();
}

export function getHoistedNoteId() {
    return getContext().get("hoistedNoteId") || "root";
}

export function getComponentId() {
    return getContext().get("componentId");
}

export function getUserId(): string | undefined {
    return getContext().get<string>("userId");
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

export function getAndClearEntityChangeIds() {
    const entityChangeIds = getContext().get("entityChangeIds") || [];

    getContext().set("entityChangeIds", []);

    return entityChangeIds;
}

export function ignoreEntityChangeIds() {
    getContext().set("ignoreEntityChangeIds", true);
}
