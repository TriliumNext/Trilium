import type { FlashcardRow, FlashcardState } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import AbstractBeccaEntity from "./abstract_becca_entity.js";

class BFlashcard extends AbstractBeccaEntity<BFlashcard> {
    static get entityName() {
        return "flashcards";
    }

    static get primaryKeyName() {
        return "cardId";
    }

    static get hashedProperties() {
        return [
            "cardId",
            "noteId",
            "deckNoteId",
            "ordinal",
            "state",
            "due",
            "stability",
            "difficulty",
            "elapsedDays",
            "scheduledDays",
            "learningSteps",
            "reps",
            "lapses",
            "lastReview",
            "suspended",
            "algorithm",
            "algorithmVersion",
            "schedulingRevision",
            "utcDateCreated",
            "utcDateModified",
            "isDeleted"
        ];
    }

    cardId?: string;
    noteId!: string;
    deckNoteId!: string;
    ordinal!: number;
    state!: FlashcardState;
    due!: string;
    stability!: number;
    difficulty!: number;
    elapsedDays!: number;
    scheduledDays!: number;
    learningSteps!: number;
    reps!: number;
    lapses!: number;
    lastReview?: string | null;
    suspended!: boolean;
    algorithm!: string;
    algorithmVersion!: string;
    schedulingRevision!: number;
    private _isDeleted?: boolean;
    deleteId?: string | null;

    constructor(row?: FlashcardRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: FlashcardRow) {
        this.cardId = row.cardId;
        this.noteId = row.noteId;
        this.deckNoteId = row.deckNoteId;
        this.ordinal = row.ordinal ?? 0;
        this.state = row.state;
        this.due = row.due;
        this.stability = row.stability;
        this.difficulty = row.difficulty;
        this.elapsedDays = row.elapsedDays;
        this.scheduledDays = row.scheduledDays;
        this.learningSteps = row.learningSteps;
        this.reps = row.reps;
        this.lapses = row.lapses;
        this.lastReview = row.lastReview ?? null;
        this.suspended = !!row.suspended;
        this.algorithm = row.algorithm ?? "fsrs-6";
        this.algorithmVersion = row.algorithmVersion ?? "ts-fsrs@5.4.1";
        this.schedulingRevision = row.schedulingRevision ?? 0;
        this.utcDateCreated = row.utcDateCreated || dateUtils.utcNowDateTime();
        this.utcDateModified = row.utcDateModified || this.utcDateCreated;
        this._isDeleted = !!row.isDeleted;
        this.deleteId = row.deleteId ?? null;
    }

    update([
        cardId,
        noteId,
        deckNoteId,
        ordinal,
        state,
        due,
        stability,
        difficulty,
        elapsedDays,
        scheduledDays,
        learningSteps,
        reps,
        lapses,
        lastReview,
        suspended,
        algorithm,
        algorithmVersion,
        schedulingRevision,
        utcDateCreated,
        utcDateModified,
        isDeleted,
        deleteId
    ]: any) {
        this.updateFromRow({
            cardId,
            noteId,
            deckNoteId,
            ordinal,
            state,
            due,
            stability,
            difficulty,
            elapsedDays,
            scheduledDays,
            learningSteps,
            reps,
            lapses,
            lastReview,
            suspended,
            algorithm,
            algorithmVersion,
            schedulingRevision,
            utcDateCreated,
            utcDateModified,
            isDeleted,
            deleteId
        });

        return this;
    }

    override init() {
        if (this.cardId && !this.isDeleted) {
            this.becca.flashcards[this.cardId] = this;
        }
    }

    override get isDeleted() {
        return !!this._isDeleted;
    }

    override beforeSaving() {
        const now = dateUtils.utcNowDateTime();

        if (!this.utcDateCreated) {
            this.utcDateCreated = now;
        }

        this.utcDateModified = now;
        this.ordinal = this.ordinal ?? 0;
        this.suspended = !!this.suspended;
        this.algorithm = this.algorithm || "fsrs-6";
        this.algorithmVersion = this.algorithmVersion || "ts-fsrs@5.4.1";
        this.schedulingRevision = this.schedulingRevision ?? 0;
        this._isDeleted = !!this._isDeleted;

        super.beforeSaving();

        if (this.cardId && !this.isDeleted) {
            this.becca.flashcards[this.cardId] = this;
        }
    }

    getPojo() {
        return {
            cardId: this.cardId,
            noteId: this.noteId,
            deckNoteId: this.deckNoteId,
            ordinal: this.ordinal,
            state: this.state,
            due: this.due,
            stability: this.stability,
            difficulty: this.difficulty,
            elapsedDays: this.elapsedDays,
            scheduledDays: this.scheduledDays,
            learningSteps: this.learningSteps,
            reps: this.reps,
            lapses: this.lapses,
            lastReview: this.lastReview,
            suspended: this.suspended,
            algorithm: this.algorithm,
            algorithmVersion: this.algorithmVersion,
            schedulingRevision: this.schedulingRevision,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified,
            isDeleted: this.isDeleted,
            deleteId: this.deleteId
        };
    }
}

export default BFlashcard;
