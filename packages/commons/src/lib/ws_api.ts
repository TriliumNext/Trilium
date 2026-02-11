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
    content?: Buffer | string;
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

type TaskDefinition<T extends TaskType> = {
    type: "taskProgressCount",
    taskId: string;
    taskType: T;
    data: TaskData<T>,
    progressCount: number
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
    type: "ping"
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
