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

export function isEntityEventsDisabled() {
    return !!getContext().get("disableEntityEvents");
}
