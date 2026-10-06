import type { EntityRowNames } from "./services/load_results.js";

interface Entity {
    isDeleted?: boolean;
}

// TODO: Deduplicate with src/services/entity_changes_interface.ts
export interface EntityChange {
    id?: number | null;
    noteId?: string;
    entityName: EntityType;
    entityId: string;
    entity?: Entity;
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

export type EntityType = "notes" | "branches" | "attributes" | "note_reordering" | "revisions" | "options" | "attachments" | "blobs" | "etapi_tokens" | "flashcards" | "flashcard_reviews";
