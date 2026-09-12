import type { LlmStreamChunk } from "./llm_api.js";

export interface EntityChange {
    id?: number | null;
    noteId?: string;
    entityName: string;
    entityId: string;
    entity?: any;
    positions?: Record<string, number>;
    hash: string;
    utcDateChanged?: string;
    utcDateModified?: string;
    utcDateCreated?: string;
    isSynced: boolean | 1 | 0;
    isErased: boolean | 1 | 0;
    componentId?: string | null;
    changeId?: string | null;
    instanceId?: string | null;
}

export interface EntityRow {
    isDeleted?: boolean;
    content?: Uint8Array | string;
}

export interface EntityChangeRecord {
    entityChange: EntityChange;
    entity?: EntityRow;
}

type TaskDataDefinitions = {
    empty: null,
    deleteNotes: null,
    undeleteNotes: null,
    export: null,
    protectNotes: {
        protect: boolean;
    }
    importNotes: {
        textImportedAsText?: boolean;
        codeImportedAsCode?: boolean;
        spreadsheetImportedAsSpreadsheet?: boolean;
        replaceUnderscoresWithSpaces?: boolean;
        shrinkImages?: boolean;
        safeImport?: boolean;
    } | null,
    importAttachments: null,
    compressImages: null
}

type TaskResultDefinitions = {
    empty: null,
    deleteNotes: null,
    undeleteNotes: null,
    export: null,
    protectNotes: null,
    importNotes: {
        parentNoteId?: string;
        importedNoteId?: string
    };
    importAttachments: {
        parentNoteId?: string;
        importedNoteId?: string
    };
    compressImages: null;
}

export type TaskType = keyof TaskDataDefinitions | keyof TaskResultDefinitions;
export type TaskData<T extends TaskType> = TaskDataDefinitions[T];
export type TaskResult<T extends TaskType> = TaskResultDefinitions[T];

/**
 * Identifies which phase of a multi-phase task a progress message belongs to, so the client can label
 * the bar accordingly (e.g. zip import counts archive entries while "extracting", then notes while
 * "processing"). Single-phase tasks omit it and the client falls back to a generic message.
 *
 * "throttled" is a transient state rather than a pipeline stage: the task is alive but deliberately
 * waiting out an external service's rate limiting (e.g. the OneNote importer under Graph throttling),
 * so the count will not move for a while and the client should say why instead of looking hung.
 */
export type ProgressPhase = "extracting" | "processing" | "throttled";

type TaskDefinition<T extends TaskType> = {
    type: "taskProgressCount",
    taskId: string;
    taskType: T;
    data: TaskData<T>,
    progressCount: number;
    /** Total expected units of work, when known up front; lets the client show a progress bar. */
    totalCount?: number;
    /** Which phase of a multi-phase task this count belongs to; lets the client pick a phase-specific label. */
    phase?: ProgressPhase;
} | {
    type: "taskError",
    taskId: string;
    taskType: T;
    data: TaskData<T>,
    message: string;
} | {
    type: "taskSucceeded",
    taskId: string;
    taskType: T;
    data: TaskData<T>,
    result: TaskResult<T>;
}

export interface OpenedFileUpdateStatus {
    entityType: string;
    entityId: string;
    lastModifiedMs?: number;
    filePath: string;
}

type AllTaskDefinitions =
    | TaskDefinition<"empty">
    | TaskDefinition<"deleteNotes">
    | TaskDefinition<"undeleteNotes">
    | TaskDefinition<"export">
    | TaskDefinition<"protectNotes">
    | TaskDefinition<"importNotes">
    | TaskDefinition<"importAttachments">;

export type WebSocketMessage = AllTaskDefinitions | {
    type: "ping",
    /**
     * Live protected-session state of the backend, present on server→client pings. Lets the client
     * detect a protected-session expiry whose `reload-frontend` broadcast never arrived (e.g. the
     * WebSocket was dead at expiry time) and reload itself. Absent on client→server pings.
     */
    protectedSessionAvailable?: boolean
} | {
    type: "frontend-update",
    data: {
        lastSyncedPush: number,
        entityChanges: EntityChange[]
    }
} | {
    type: "openNote",
    noteId: string
} | OpenedFileUpdateStatus & {
    type: "openedFileUpdated"
} | {
    type: "protectedSessionLogin"
} | {
    type: "protectedSessionLogout"
} | {
    type: "toast",
    message: string;
    timeout?: number;
} | {
    type: "api-log-messages",
    noteId: string,
    messages: string[]
} | {
    type: "execute-script";
    script: string;
    params: unknown[];
    startNoteId?: string;
    currentNoteId: string;
    originEntityName: string;
    originEntityId?: string | null;
} | {
    type: "reload-frontend";
    reason: string;
} | {
    type: "sync-pull-in-progress" | "sync-push-in-progress" | "sync-finished" | "sync-failed";
    lastSyncedPush: number;
} | {
    /**
     * Syncing stopped because the content hashes of these sectors kept differing from the sync
     * server's even after re-syncing them: the two databases hold data sync cannot reconcile. Unlike
     * every other sync failure this one does not resolve itself by retrying, so it is surfaced to
     * the user instead of only being logged.
     */
    type: "sync-hash-check-failed";
    /** The diverged sectors, each as `entityName/sector` (e.g. `blobs/9`). */
    sectors: string[];
} | {
    type: "consistency-checks-failed"
} | {
    /**
     * An error that escaped every other handler and reached the process-level safety net — typically a
     * throw from deferred background work (a timer, a floating promise), which has no request to fail.
     * The backend keeps running; this only tells the user that something went wrong, since the failure
     * would otherwise be invisible outside the log.
     */
    type: "unhandled-error";
    /** The error message, shown directly in the notification. */
    message: string;
    /**
     * The stack trace, kept behind a "view more details" step rather than shown up front: it is what
     * makes a bug report actionable, and nothing the user is expected to read. Absent when the thrown
     * value carried no stack.
     */
    stack?: string;
} | {
    /**
     * One chunk of an LLM chat completion, for runtimes that cannot carry the Server-Sent Events the
     * `llm-chat/stream` route replies with — the standalone build answers a request with a single
     * buffered body, so its chunks ride this channel instead. `streamId` is minted by the client
     * before it asks for the completion, and is what lets the tab that asked pick its own chunks out
     * of a channel every tab receives.
     */
    type: "llm-stream";
    streamId: string;
    chunk: LlmStreamChunk;
} | {
    /**
     * Marks the end of an {@link WebSocketMessage} `llm-stream` sequence, whether it ended in a `done`
     * chunk, an error or an abort. It is deliberately not a `done` chunk: an errored stream must not
     * finalize the assistant message, and the last chunk alone cannot say which case it was.
     */
    type: "llm-stream-end";
    streamId: string;
}
