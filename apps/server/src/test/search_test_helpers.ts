/**
 * Test helpers for search functionality testing
 *
 * This module provides factory functions and utilities for creating test notes
 * with various attributes, relations, and configurations for comprehensive
 * search testing.
 */

import BNote from "../becca/entities/bnote.js";
import BBranch from "../becca/entities/bbranch.js";
import BAttribute from "../becca/entities/battribute.js";
import becca from "../becca/becca.js";
import { NoteBuilder, id, note } from "./becca_mocking.js";
import type { NoteType } from "@triliumnext/commons";
import dateUtils from "../services/date_utils.js";

/**
 * Extended note builder with additional helper methods for search testing
 */
export class SearchTestNoteBuilder extends NoteBuilder {
    /**
     * Add multiple labels at once
     */
    labels(labelMap: Record<string, string | { value: string; isInheritable?: boolean }>) {
        for (const [name, labelValue] of Object.entries(labelMap)) {
            if (typeof labelValue === 'string') {
                this.label(name, labelValue);
            } else {
                this.label(name, labelValue.value, labelValue.isInheritable || false);
            }
        }
        return this;
    }

    /**
     * Add multiple relations at once
     */
    relations(relationMap: Record<string, BNote>) {
        for (const [name, targetNote] of Object.entries(relationMap)) {
            this.relation(name, targetNote);
        }
        return this;
    }

    /**
     * Add multiple children at once
     */
    children(...childBuilders: NoteBuilder[]) {
        for (const childBuilder of childBuilders) {
            this.child(childBuilder);
        }
        return this;
    }

    /**
     * Set note as protected
     */
    protected(isProtected = true) {
        this.note.isProtected = isProtected;
        return this;
    }

    /**
     * Set note as archived
     */
    archived(isArchived = true) {
        if (isArchived) {
            this.label("archived", "", true);
        } else {
            // Remove archived label if exists
            const archivedLabels = this.note.getOwnedLabels("archived");
            for (const label of archivedLabels) {
                label.markAsDeleted();
            }
        }
        return this;
    }

    /**
     * Set note type and mime
     */
    asType(type: NoteType, mime?: string) {
        this.note.type = type;
        if (mime) {
            this.note.mime = mime;
        }
        return this;
    }

    /**
     * Set note content
     * Content is stored in the blob system via setContent()
     */
    content(content: string | Buffer) {
        this.note.setContent(content, { forceSave: true });
        return this;
    }

    /**
     * Set note dates
     */
    dates(options: {
        dateCreated?: string;
        dateModified?: string;
        utcDateCreated?: string;
        utcDateModified?: string;
    }) {
        if (options.dateCreated) this.note.dateCreated = options.dateCreated;
        if (options.dateModified) this.note.dateModified = options.dateModified;
        if (options.utcDateCreated) this.note.utcDateCreated = options.utcDateCreated;
        if (options.utcDateModified) this.note.utcDateModified = options.utcDateModified;
        return this;
    }
}

/**
 * Create a search test note with extended capabilities
 */
export function searchNote(title: string, extraParams: Partial<{
    noteId: string;
    type: NoteType;
    mime: string;
    isProtected: boolean;
    dateCreated: string;
    dateModified: string;
    utcDateCreated: string;
    utcDateModified: string;
}> = {}): SearchTestNoteBuilder {
    const row = Object.assign(
        {
            noteId: extraParams.noteId || id(),
            title: title,
            type: "text" as NoteType,
            mime: "text/html"
        },
        extraParams
    );

    const note = new BNote(row);
    return new SearchTestNoteBuilder(note);
}

/**
 * Create a hierarchy of notes from a simple structure definition
 *
 * @example
 * createHierarchy(root, {
 *   "Europe": {
 *     "Austria": { labels: { capital: "Vienna" } },
 *     "Germany": { labels: { capital: "Berlin" } }
 *   }
 * });
 */
export function createHierarchy(
    parent: NoteBuilder,
    structure: Record<string, {
        children?: Record<string, any>;
        labels?: Record<string, string>;
        relations?: Record<string, BNote>;
        type?: NoteType;
        mime?: string;
        content?: string;
        isProtected?: boolean;
        isArchived?: boolean;
    }>
): Record<string, SearchTestNoteBuilder> {
    const createdNotes: Record<string, SearchTestNoteBuilder> = {};

    for (const [title, config] of Object.entries(structure)) {
        const noteBuilder = searchNote(title, {
            type: config.type,
            mime: config.mime,
            isProtected: config.isProtected
        });

        if (config.labels) {
            noteBuilder.labels(config.labels);
        }

        if (config.relations) {
            noteBuilder.relations(config.relations);
        }

        if (config.content) {
            noteBuilder.content(config.content);
        }

        if (config.isArchived) {
            noteBuilder.archived(true);
        }

        parent.child(noteBuilder);
        createdNotes[title] = noteBuilder;

        if (config.children) {
            const childNotes = createHierarchy(noteBuilder, config.children);
            Object.assign(createdNotes, childNotes);
        }
    }

    return createdNotes;
}

/**
 * Create a note with full-text content for testing content search
 */
export function contentNote(title: string, content: string, extraParams = {}): SearchTestNoteBuilder {
    return searchNote(title, extraParams).content(content);
}

/**
 * Create a code note with specific mime type
 */
export function codeNote(title: string, code: string, mime = "text/javascript"): SearchTestNoteBuilder {
    return searchNote(title, { type: "code", mime }).content(code);
}

/**
 * Create a protected note with encrypted content
 */
export function protectedNote(title: string, content = ""): SearchTestNoteBuilder {
    return searchNote(title, { isProtected: true }).content(content);
}

/**
 * Create an archived note
 */
export function archivedNote(title: string): SearchTestNoteBuilder {
    return searchNote(title).archived(true);
}

/**
 * Create a note with date-related labels for date comparison testing
 */
export function dateNote(title: string, options: {
    year?: number;
    month?: string;
    date?: string;
    dateTime?: string;
} = {}): SearchTestNoteBuilder {
    const noteBuilder = searchNote(title);
    const labels: Record<string, string> = {};

    if (options.year) {
        labels.year = options.year.toString();
    }
    if (options.month) {
        labels.month = options.month;
    }
    if (options.date) {
        labels.date = options.date;
    }
    if (options.dateTime) {
        labels.dateTime = options.dateTime;
    }

    return noteBuilder.labels(labels);
}

/**
 * Create a note with creation/modification dates for temporal testing
 */
export function temporalNote(title: string, options: {
    daysAgo?: number;
    hoursAgo?: number;
    minutesAgo?: number;
} = {}): SearchTestNoteBuilder {
    const noteBuilder = searchNote(title);

    if (options.daysAgo !== undefined || options.hoursAgo !== undefined || options.minutesAgo !== undefined) {
        const now = new Date();

        if (options.daysAgo !== undefined) {
            now.setDate(now.getDate() - options.daysAgo);
        }
        if (options.hoursAgo !== undefined) {
            now.setHours(now.getHours() - options.hoursAgo);
        }
        if (options.minutesAgo !== undefined) {
            now.setMinutes(now.getMinutes() - options.minutesAgo);
        }

        // Format the calculated past date for both local and UTC timestamps
        const utcDateCreated = dateUtils.utcDateTimeStr(now);
        const dateCreated = dateUtils.utcDateTimeStr(now);
        noteBuilder.dates({ dateCreated, utcDateCreated });
    }

    return noteBuilder;
}

/**
 * Create a note with numeric labels for numeric comparison testing
 */
export function numericNote(title: string, numericLabels: Record<string, number>): SearchTestNoteBuilder {
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(numericLabels)) {
        labels[key] = value.toString();
    }
    return searchNote(title).labels(labels);
}

/**
 * Create notes with relationship chains for multi-hop testing
 *
 * @example
 * const chain = createRelationChain(["Book", "Author", "Country"], "writtenBy");
 * // Book --writtenBy--> Author --writtenBy--> Country
 */
export function createRelationChain(titles: string[], relationName: string): SearchTestNoteBuilder[] {
    const notes = titles.map(title => searchNote(title));

    for (let i = 0; i < notes.length - 1; i++) {
        notes[i].relation(relationName, notes[i + 1].note);
    }

    return notes;
}

/**
 * Create a book note with common book attributes
 */
export function bookNote(title: string, options: {
    author?: BNote;
    publicationYear?: number;
    genre?: string;
    isbn?: string;
    publisher?: string;
} = {}): SearchTestNoteBuilder {
    const noteBuilder = searchNote(title).label("book", "", true);

    if (options.author) {
        noteBuilder.relation("author", options.author);
    }

    const labels: Record<string, string> = {};
    if (options.publicationYear) labels.publicationYear = options.publicationYear.toString();
    if (options.genre) labels.genre = options.genre;
    if (options.isbn) labels.isbn = options.isbn;
    if (options.publisher) labels.publisher = options.publisher;

    if (Object.keys(labels).length > 0) {
        noteBuilder.labels(labels);
    }

    return noteBuilder;
}

/**
 * Create a person note with common person attributes
 */
export function personNote(name: string, options: {
    birthYear?: number;
    country?: string;
    profession?: string;
    relations?: Record<string, BNote>;
} = {}): SearchTestNoteBuilder {
    const noteBuilder = searchNote(name).label("person", "", true);

    const labels: Record<string, string> = {};
    if (options.birthYear) labels.birthYear = options.birthYear.toString();
    if (options.country) labels.country = options.country;
    if (options.profession) labels.profession = options.profession;

    if (Object.keys(labels).length > 0) {
        noteBuilder.labels(labels);
    }

    if (options.relations) {
        noteBuilder.relations(options.relations);
    }

    return noteBuilder;
}

/**
 * Create a country note with common attributes
 */
export function countryNote(name: string, options: {
    capital?: string;
    population?: number;
    continent?: string;
    languageFamily?: string;
    established?: string;
} = {}): SearchTestNoteBuilder {
    const noteBuilder = searchNote(name).label("country", "", true);

    const labels: Record<string, string> = {};
    if (options.capital) labels.capital = options.capital;
    if (options.population) labels.population = options.population.toString();
    if (options.continent) labels.continent = options.continent;
    if (options.languageFamily) labels.languageFamily = options.languageFamily;
    if (options.established) labels.established = options.established;

    if (Object.keys(labels).length > 0) {
        noteBuilder.labels(labels);
    }

    return noteBuilder;
}

/**
 * Generate a large dataset of notes for performance testing
 */
export function generateLargeDataset(root: NoteBuilder, options: {
    noteCount?: number;
    maxDepth?: number;
    labelsPerNote?: number;
    relationsPerNote?: number;
} = {}): SearchTestNoteBuilder[] {
    const {
        noteCount = 100,
        maxDepth = 3,
        labelsPerNote = 2,
        relationsPerNote = 1
    } = options;

    const allNotes: SearchTestNoteBuilder[] = [];
    const categories = ["Tech", "Science", "History", "Art", "Literature"];

    function createNotesAtLevel(parent: NoteBuilder, depth: number, remaining: number): number {
        if (depth >= maxDepth || remaining <= 0) return 0;

        const notesAtThisLevel = Math.min(remaining, Math.ceil(remaining / (maxDepth - depth)));

        for (let i = 0; i < notesAtThisLevel && remaining > 0; i++) {
            const category = categories[i % categories.length];
            const noteBuilder = searchNote(`${category} Note ${allNotes.length + 1}`);

            // Add labels
            for (let j = 0; j < labelsPerNote; j++) {
                noteBuilder.label(`label${j}`, `value${j}_${allNotes.length}`);
            }

            // Add relations to previous notes
            for (let j = 0; j < relationsPerNote && allNotes.length > 0; j++) {
                const targetIndex = Math.floor(Math.random() * allNotes.length);
                noteBuilder.relation(`related${j}`, allNotes[targetIndex].note);
            }

            parent.child(noteBuilder);
            allNotes.push(noteBuilder);
            remaining--;

            // Recurse to create children
            remaining = createNotesAtLevel(noteBuilder, depth + 1, remaining);
        }

        return remaining;
    }

    createNotesAtLevel(root, 0, noteCount);
    return allNotes;
}

/**
 * Create notes with special characters for testing escaping
 */
export function specialCharNote(title: string, specialContent: string): SearchTestNoteBuilder {
    return searchNote(title).content(specialContent);
}

/**
 * Create notes with Unicode content
 */
export function unicodeNote(title: string, unicodeContent: string): SearchTestNoteBuilder {
    return searchNote(title).content(unicodeContent);
}

/**
 * Clean up all test notes from becca
 */
export function cleanupTestNotes(): void {
    becca.reset();
}

/**
 * Get all notes matching a predicate
 */
export function getNotesByPredicate(predicate: (note: BNote) => boolean): BNote[] {
    return Object.values(becca.notes).filter(predicate);
}

/**
 * Count notes with specific label
 */
export function countNotesWithLabel(labelName: string, labelValue?: string): number {
    return Object.values(becca.notes).filter(note => {
        const labels = note.getOwnedLabels(labelName);
        if (labelValue === undefined) {
            return labels.length > 0;
        }
        return labels.some(label => label.value === labelValue);
    }).length;
}

/**
 * Find note by ID with type safety
 */
export function findNote(noteId: string): BNote | undefined {
    return becca.notes[noteId];
}

/**
 * Assert note exists
 */
export function assertNoteExists(noteId: string): BNote {
    const note = becca.notes[noteId];
    if (!note) {
        throw new Error(`Note with ID ${noteId} does not exist`);
    }
    return note;
}
