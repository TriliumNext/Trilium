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

/**
 * While an import materializes its content tree, a `#newNotesOnTop` label inherited onto the import target
 * would otherwise make {@link getNewNotePosition} insert each created note *above* the previous one, silently
 * reversing the source order. Importers turn this on to keep imported content in its original order.
 *
 * It is turned on deliberately *after* an importer has created its own top-level root note, so that single
 * root note still honours `newNotesOnTop` and floats to the top of the target (the reason users set the
 * label) — only the content *underneath* it is order-preserved. The flag lives for the import's CLS context
 * only, so it never needs clearing (each import runs in its own context, like `disableEntityEvents`).
 */
export function setImportOrderPreserved(preserved: boolean) {
    getContext().set("importOrderPreserved", !!preserved);
}

export function isImportOrderPreserved() {
    return !!getContext().get("importOrderPreserved");
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
