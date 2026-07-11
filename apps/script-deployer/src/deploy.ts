/**
 * Core deployment logic for Trilium scripts.
 *
 * Extracted from dev.ts so it can be tested without the full server lifecycle.
 */

import { extname } from "node:path";
import { transformSync } from "esbuild";
// ── Public constants ─────────────────────────────────────────────────────────

export const SCRIPTS_NOTE_ID = "_scripts";

export const MIME_BY_EXT: Record<string, string> = {
    ".jsx": "text/jsx",
    ".tsx": "text/jsx",
    ".js": "application/javascript;env=frontend",
    ".ts": "application/javascript;env=backend",
    ".html": "text/html",
    ".css": "text/css",
};

// ── Front-matter parsing ─────────────────────────────────────────────────────

export interface ScriptMeta {
    id: string;
    type: string;
    title: string;
    [key: string]: string;
}

/**
 * Parses the `@trilium-script` YAML front matter from a JSDoc comment block.
 *
 * ```
 * /**
 *  * @trilium-script
 *  *
 *  * id: my-script
 *  * type: render
 *  * title: My Script
 *  *\/
 * ```
 *
 * Returns `null` (with a console error) when the marker is missing or
 * required fields (`id`, `type`, `title`) are absent.
 */
export function parseScriptMeta(source: string, filePath: string): ScriptMeta | null {
    const match = source.match(/\/\*\*[\s\S]*?@trilium-script\s*([\s\S]*?)\*\//);
    if (!match) return null;

    const block = match[1];
    const meta: Record<string, string> = {};

    for (const line of block.split("\n")) {
        const cleaned = line.replace(/^\s*\*\s?/, "").trim();
        if (!cleaned) continue;

        const colon = cleaned.indexOf(":");
        if (colon === -1) continue;

        const key = cleaned.slice(0, colon).trim();
        const value = cleaned.slice(colon + 1).trim();
        if (key && value) meta[key] = value;
    }

    const missing = ["id", "type", "title"].filter((k) => !meta[k]);
    if (missing.length) {
        console.error(`  SKIP ${filePath}: missing required fields: ${missing.join(", ")}`);
        return null;
    }

    return meta as ScriptMeta;
}

// ── Transpilation ────────────────────────────────────────────────────────────

/** Extensions that need esbuild transpilation before deployment. */
const TRANSPILE_EXTS = new Set([".ts", ".tsx"]);

/**
 * Strips TypeScript type annotations via esbuild, preserving JSX intact.
 * Trilium's frontend handles JSX natively, so we only strip types.
 */
export function transpile(source: string, filePath: string): string {
    const ext = extname(filePath);
    if (!TRANSPILE_EXTS.has(ext)) return source;

    const isBackend = ext === ".ts";
    const result = transformSync(source, {
        loader: ext === ".tsx" ? "tsx" : "ts",
        jsx: "preserve",
        sourcemap: false,
        ...(isBackend && { format: "cjs" }),
    });
    return result.code;
}

// ── Note ID helpers ──────────────────────────────────────────────────────────

export function codeNoteId(scriptId: string) {
    return `_sd_${scriptId}`;
}

export function renderNoteId(scriptId: string) {
    return `_sd_${scriptId}_render`;
}

// ── Deployment ───────────────────────────────────────────────────────────────

/**
 * Abstraction over the note-creation service so that tests can supply
 * a mock while the real dev server passes the actual `notesService`.
 */
export interface NoteService {
    createNewNote(params: {
        noteId: string;
        parentNoteId: string;
        title: string;
        type: string; // NoteType union at runtime, kept as string for test compatibility
        mime?: string;
        content: string;
    }): { note: { noteId: string } };
}

/** Helper to cast the real notesService (which uses NoteType) to our interface. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asNoteService(svc: any): NoteService {
    return svc as NoteService;
}

export interface BeccaLike {
    notes: Record<string, {
        noteId: string;
        title: string;
        save(): void;
        setContent(content: string): void;
        setRelation(name: string, targetNoteId: string): void;
        setLabel(name: string, value?: string): void;
        invalidateThisCache(): void;
    }>;
}

export interface DeployResult {
    action: "created" | "updated";
    codeNoteId: string;
    renderNoteId?: string;
    title: string;
    type: string;
}

/** Labels that map directly from front-matter keys to note attributes. */
const PASSTHROUGH_LABELS = ["run", "executeButton", "executeDescription", "executeTitle"] as const;

function applyLabels(note: BeccaLike["notes"][string], meta: ScriptMeta) {
    note.setLabel("readOnly");
    for (const label of PASSTHROUGH_LABELS) {
        if (meta[label]) {
            note.setLabel(label, meta[label]);
        }
    }
    // BNote caches attributes eagerly during setLabel's save() path.
    // Invalidate so subsequent reads see all labels we just set.
    note.invalidateThisCache();
}

/**
 * Deploys a single script file into the Trilium note tree.
 *
 * - For `type: render`: creates a render note with a child code note
 *   linked via `~renderNote`.
 * - For other types: creates a plain code note under the scripts folder.
 * - If the code note already exists, only its content and title are updated.
 */
export function deployScript(
    meta: ScriptMeta,
    content: string,
    mime: string,
    becca: BeccaLike,
    notesService: NoteService,
    parentNoteId: string = SCRIPTS_NOTE_ID,
): DeployResult {
    const codeId = codeNoteId(meta.id);
    const existing = becca.notes[codeId];

    if (existing) {
        existing.title = meta.title;
        existing.save();
        existing.setContent(content);
        applyLabels(existing, meta);
        return { action: "updated", codeNoteId: codeId, title: meta.title, type: meta.type };
    }

    if (meta.type === "render") {
        const renderId = renderNoteId(meta.id);

        notesService.createNewNote({
            noteId: renderId,
            parentNoteId,
            title: meta.title,
            type: "render",
            content: "",
        });

        notesService.createNewNote({
            noteId: codeId,
            parentNoteId: renderId,
            title: meta.title,
            type: "code",
            mime,
            content,
        });

        const renderNote = becca.notes[renderId];
        renderNote.setRelation("renderNote", codeId);

        return { action: "created", codeNoteId: codeId, renderNoteId: renderId, title: meta.title, type: meta.type };
    }

    // Plain code note (backend script, widget, etc.)
    notesService.createNewNote({
        noteId: codeId,
        parentNoteId,
        title: meta.title,
        type: "code",
        mime,
        content,
    });

    applyLabels(becca.notes[codeId], meta);

    return { action: "created", codeNoteId: codeId, title: meta.title, type: meta.type };
}
