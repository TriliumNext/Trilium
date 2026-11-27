/**
 * @module
 *
 * Script channels: notes that own `#notificationChannel`. What an enabling reviews is a record of
 * every note that the bundle of the script and of its `~configWidget` reads, with every owned
 * attribute of each, and a run builds the bundle from that record alone.
 */
import {
    NOTIFICATION_CHANNEL_LABEL,
    NOTIFICATION_CHANNEL_WIDGET_RELATION,
    type NotificationChannelAttributeChange,
    type NotificationChannelBundle,
    type NotificationChannelRunsOn
} from "@triliumnext/commons";

import becca from "../../../becca/becca.js";
import type BAttribute from "../../../becca/entities/battribute.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getCrypto } from "../../encryption/crypto.js";
import {
    type Bundle,
    buildBundle,
    collectScriptRecord,
    type ScriptRecordNote,
    toBundle
} from "../../script.js";
import { encodeBase64 } from "../../utils/binary.js";
import type { AttributeSnapshot } from "../model.js";

/** A note that owns `#notificationChannel`. Its `channelId` is its note ID. */
export interface ScriptChannel {
    channelId: string;
    note: BNote;
    label: BAttribute;
    runsOn: NotificationChannelRunsOn;
}

/** What an enabling reviews: the record of the script and that of its settings widget. */
export interface ChannelRecord {
    script: ScriptRecordNote;
    configWidget?: ScriptRecordNote;
}

/** The record of a script channel as collected now, with the notes that it read. */
export interface CollectedChannel {
    record: ChannelRecord;
    /** The SHA-512 of the record, in base64url. */
    revision: string;
    /** The SHA-512 of the record without the channel note's own attributes. */
    restRevision: string;
    ownedAttributes: AttributeSnapshot[];
    notes: ReadonlyMap<string, BNote | null>;
    widgetNotes: ReadonlyMap<string, BNote | null>;
}

/** The script channels of the database: notes that own the label, of a script that can run. */
export function findScriptChannels(): ScriptChannel[] {
    const channels = new Map<string, ScriptChannel>();
    for (const label of becca.findAttributes("label", NOTIFICATION_CHANNEL_LABEL)) {
        const channel = label.isDeleted ? null : getScriptChannel(label.noteId);
        if (channel) {
            channels.set(channel.channelId, channel);
        }
    }
    return [ ...channels.values() ].sort((a, b) => a.channelId.localeCompare(b.channelId));
}

/** The script channel of a note, or `null` when the note does not own the label. */
export function getScriptChannel(noteId: string): ScriptChannel | null {
    const note = becca.getNote(noteId);
    const label = note?.getOwnedLabels(NOTIFICATION_CHANNEL_LABEL)[0];
    const env = note?.getScriptEnv();
    if (!note || note.isDeleted || !label || (env !== "backend" && env !== "frontend")
        || !(note.isJavaScript() || note.isJsx())) {
        return null;
    }
    return { channelId: note.noteId, note, label, runsOn: env };
}

/** Whether a note owns the label, whatever it runs: such a note and its subtree are a channel's. */
export function isChannelNote(note: BNote) {
    return note.getOwnedLabels(NOTIFICATION_CHANNEL_LABEL).length > 0;
}

/**
 * Collects the record of a channel and its two revisions.
 *
 * @returns `null` when a note of the bundle has content that is not available.
 */
export function collectChannel(channel: ScriptChannel): CollectedChannel | null {
    const notes = new Map<string, BNote | null>();
    const widgetNotes = new Map<string, BNote | null>();
    let record: ChannelRecord;
    try {
        const script = collectScriptRecord(channel.note, channel.runsOn, true, notes);
        if (!script) {
            return null;
        }
        record = { script };
        const widgetNote = getConfigWidgetNote(channel.note);
        const configWidget = widgetNote
            ? collectScriptRecord(widgetNote, "frontend", true, widgetNotes)
            : undefined;
        if (configWidget) {
            record.configWidget = configWidget;
        }
    } catch {
        return null;
    }

    const ownedAttributes = record.script.attributes.map(
        ({ type, name, value, isInheritable }) => ({ type, name, value, isInheritable }));
    return {
        record,
        revision: hashRecord(record),
        restRevision: hashRecord({ ...record, script: { ...record.script, attributes: [] } }),
        ownedAttributes,
        notes,
        widgetNotes
    };
}

/** The note that the channel note's own `~configWidget` relation points to. */
export function getConfigWidgetNote(note: BNote): BNote | null {
    const relation = note.getOwnedRelations(NOTIFICATION_CHANNEL_WIDGET_RELATION)[0];
    return relation ? becca.getNote(relation.value) : null;
}

/** The backend bundle of a collected channel, built from its record. */
export function getBackendBundle(collected: CollectedChannel): Bundle {
    return toBundle(collected.record.script, collected.notes, "backend");
}

/** The frontend bundle of a collected channel, or of its settings widget, as the client runs it. */
export function getFrontendBundle(
    collected: CollectedChannel,
    part: "script" | "configWidget"
): NotificationChannelBundle | null {
    const record = collected.record[part];
    if (!record) {
        return null;
    }
    const built = buildBundle(record, "frontend");
    return {
        script: built.script,
        html: built.html,
        noteId: record.noteId,
        allNoteIds: built.allNoteIds
    };
}

/**
 * The record as text: each note with its ID, title, type, MIME, environment, owned attributes and
 * content, invisible and bidirectional control characters written as code points.
 */
export function formatReviewText(record: ChannelRecord) {
    const lines: string[] = [];
    appendNote(lines, record.script, 0);
    if (record.configWidget) {
        lines.push("", "=== ~configWidget ===", "");
        appendNote(lines, record.configWidget, 0);
    }
    return markControlCharacters(lines.join("\n"));
}

/** The owned attributes of a channel note that were added, changed or removed since `before`. */
export function diffAttributes(
    before: AttributeSnapshot[],
    after: AttributeSnapshot[]
): NotificationChannelAttributeChange[] {
    const changes: NotificationChannelAttributeChange[] = [];
    const remaining = [ ...before ];
    const added: AttributeSnapshot[] = [];
    for (const attribute of after) {
        const index = remaining.findIndex((old) => isSameAttribute(old, attribute));
        if (index === -1) {
            added.push(attribute);
        } else {
            remaining.splice(index, 1);
        }
    }

    for (const attribute of added) {
        const index = remaining.findIndex((old) =>
            old.type === attribute.type && old.name === attribute.name);
        const old = index === -1 ? null : remaining.splice(index, 1)[0];
        changes.push(old
            ? { change: "changed", type: attribute.type, name: attribute.name,
                value: markControlCharacters(attribute.value),
                previousValue: markControlCharacters(old.value) }
            : { change: "added", type: attribute.type, name: attribute.name,
                value: markControlCharacters(attribute.value) });
    }
    for (const old of remaining) {
        changes.push({ change: "removed", type: old.type, name: old.name,
            previousValue: markControlCharacters(old.value) });
    }
    return changes;
}

/** Writes each invisible or bidirectional control character as its code point, `[U+202E]`. */
export function markControlCharacters(text: string) {
    return text.replace(CONTROL_CHARACTERS, (character) =>
        `[U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`);
}

/** Every control character but the line feed and the tab, and the characters that show nothing. */
const CONTROL_CHARACTERS = new RegExp([
    "[\\u{0}-\\u{8}\\u{B}-\\u{1F}\\u{7F}-\\u{9F}\\u{AD}\\u{34F}\\u{61C}\\u{115F}\\u{1160}",
    "\\u{17B4}\\u{17B5}\\u{180B}-\\u{180F}\\u{200B}-\\u{200F}\\u{202A}-\\u{202E}",
    "\\u{2060}-\\u{206F}\\u{3164}\\u{FE00}-\\u{FE0F}\\u{FEFF}\\u{FFA0}\\u{FFF0}-\\u{FFFB}",
    "\\u{E0000}-\\u{E0FFF}]"
].join(""), "gu");

function appendNote(lines: string[], note: ScriptRecordNote, depth: number) {
    const indent = "  ".repeat(depth);
    if (note.isRepeat) {
        lines.push(`${indent}Note ${note.noteId}, included above`);
        return;
    }

    lines.push(`${indent}Note ${note.noteId} ${JSON.stringify(note.title)}, ${note.type}, `
        + `${note.mime}, ${note.env ?? "no environment"}`);
    for (const { type, name, value, isInheritable } of note.attributes) {
        const prefix = type === "label" ? "#" : "~";
        const suffix = isInheritable ? " (inheritable)" : "";
        lines.push(`${indent}  ${prefix}${name}=${JSON.stringify(value)}${suffix}`);
    }
    lines.push(`${indent}--- content of ${note.noteId} ---`, note.content,
        `${indent}--- end of ${note.noteId} ---`);
    for (const child of note.children) {
        appendNote(lines, child, depth + 1);
    }
}

function hashRecord(record: ChannelRecord) {
    return hashText(JSON.stringify(record));
}

/** The SHA-512 of a text, in base64url, which fits the charset of a token. */
export function hashText(text: string) {
    const digest = getCrypto().createHash("sha512", text);
    return encodeBase64(digest).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function isSameAttribute(a: AttributeSnapshot, b: AttributeSnapshot) {
    return a.type === b.type && a.name === b.name && a.value === b.value
        && a.isInheritable === b.isInheritable;
}
