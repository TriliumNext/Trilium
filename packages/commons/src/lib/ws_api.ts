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
    importAttachments: null
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
}

export type TaskType = keyof TaskDataDefinitions | keyof TaskResultDefinitions;
export type TaskData<T extends TaskType> = TaskDataDefinitions[T];
export type TaskResult<T extends TaskType> = TaskResultDefinitions[T];

/**
 * Identifies which phase of a multi-phase task a progress message belongs to, so the client can label
 * the bar accordingly (e.g. zip import counts archive entries while "extracting", then notes while
 * "processing"). Single-phase tasks omit it and the client falls back to a generic message.
 */
export type ProgressPhase = "extracting" | "processing";

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
    type: "consistency-checks-failed"
}
