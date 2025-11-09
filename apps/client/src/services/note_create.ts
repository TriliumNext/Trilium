import appContext from "../components/app_context.js";
import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";
import ws from "./ws.js";
import froca from "./froca.js";
import treeService from "./tree.js";
import toastService from "./toast.js";
import { t } from "./i18n.js";
import type FNote from "../entities/fnote.js";
import type FBranch from "../entities/fbranch.js";
import type { ChooseNoteTypeResponse } from "../widgets/dialogs/note_type_chooser.js";
import type { CKTextEditor } from "@triliumnext/ckeditor5";
import dateNoteService from "../services/date_notes.js";

/**
 * Defines the type hierarchy and rules for valid argument combinations
 * accepted by `note_create`.
 *
 * ## Overview
 * Each variant extends `CreateNoteOpts` and enforces specific constraints to
 * ensure only valid note creation options are allowed at compile time.
 *
 * ## Type Safety
 * The `PromptingRule` ensures that `promptForType` and `type` stay mutually
 * exclusive (if prompting, `type` is undefined).
 *
 * The type system prevents invalid argument mixes by design — successful type
 * checks guarantee a valid state, following Curry–Howard correspondence
 * principles (types as proofs).
 *
 * ## Maintenance
 * If adding or modifying `Opts`, ensure:
 * - All valid combinations are represented (avoid *false negatives*).
 * - No invalid ones slip through (avoid *false positives*).
 *
 * Hierarchy (general → specific):
 * - CreateNoteOpts
 *   - CreateNoteWithUrlOpts
 *   - CreateNoteIntoInboxOpts
 */

/** enforces a truth rule:
 * - If `promptForType` is true → `type` must be undefined.
 * - If `promptForType` is false → `type` must be defined.
 */
type PromptingRule = {
  promptForType: true;
  type?: never;
} | {
  promptForType?: false;
  /**
   * The note type (e.g. "text", "code", "image", "mermaid", etc.).
   *
   * If omitted, the server will automatically default to `"text"`.
   * TypeScript still enforces explicit typing unless `promptForType` is true,
   * to encourage clarity at the call site.
   */
  type?: string;
};


/**
 * Base type for all note creation options (domain hypernym).
 * All specific note option types extend from this.
 *
 * Combine with `&` to ensure valid logical combinations.
 */
type CreateNoteBase = {
    isProtected?: boolean;
    saveSelection?: boolean;
    title?: string | null;
    content?: string | null;
    type?: string;
    mime?: string;
    templateNoteId?: string;
    activate?: boolean;
    focus?: "title" | "content";
    textEditor?: CKTextEditor;
} & PromptingRule;

/*
 * Defines options for creating a note at a specific path.
 * Serves as a base for "into", "before", and "after" variants,
 * sharing common URL-related fields.
 */
export type CreateNoteWithUrlOpts =
    | (CreateNoteBase & {
          target: "into";
          parentNoteUrl?: string;
          // No branch ID needed for "into"
      })
    | (CreateNoteBase & {
          target: "before" | "after";
          parentNoteUrl?: string;
          // Required for "before"/"after"
          targetBranchId: string;
      });

export type CreateNoteIntoInboxOpts = CreateNoteBase & {
    target: "inbox";
    parentNoteUrl?: never;
};

export type CreateNoteOpts = CreateNoteWithUrlOpts | CreateNoteIntoInboxOpts;

interface Response {
    // TODO: Deduplicate with server once we have client/server architecture.
    note: FNote;
    branch: FBranch;
}

interface DuplicateResponse {
    // TODO: Deduplicate with server once we have client/server architecture.
    note: FNote;
}

async function createNote(
  options: CreateNoteOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {

    let resolvedOptions = { ...options };

    // handle prompts centrally to write once fix for all
    if (options.promptForType) {
        const maybeResolvedOptions = await promptForType(options);
        if (!maybeResolvedOptions) {
            return { note: null, branch: undefined };
        }

        resolvedOptions = maybeResolvedOptions;
    }


    switch(resolvedOptions.target) {
        case "inbox":
            return createNoteIntoInbox(resolvedOptions);
        case "into":
        case "before":
        case "after":
            return createNoteWithUrl(resolvedOptions);
    }
}

async function promptForType(
  options: CreateNoteOpts
) : Promise<CreateNoteOpts | null> {
    const { success, noteType, templateNoteId, notePath } = await chooseNoteType();

    if (!success) {
        return null;
    }

    let resolvedOptions: CreateNoteOpts = {
        ...options,
        promptForType: false,
        type: noteType,
        templateNoteId,
    };

    if (notePath) {
        resolvedOptions = {
            ...resolvedOptions,
            target: "into",
            parentNoteUrl: notePath,
        };
    }

    return resolvedOptions;
}

/**
 * Creates a new note under a specified parent note path.
 *
 * @param target - Mirrors the `createNote` API in apps/server/src/routes/api/notes.ts.
 * @param options - Note creation options
 * @returns A promise resolving with the created note and its branch.
 */
async function createNoteWithUrl(
    options: CreateNoteWithUrlOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {
    options = Object.assign(
        {
            activate: true,
            focus: "title",
            target: "into"
        },
        options
    );

    // if isProtected isn't available (user didn't enter password yet), then note is created as unencrypted,
    // but this is quite weird since the user doesn't see WHERE the note is being created, so it shouldn't occur often
    if (!options.isProtected || !protectedSessionHolder.isProtectedSessionAvailable()) {
        options.isProtected = false;
    }

    if (appContext.tabManager.getActiveContextNoteType() !== "text") {
        options.saveSelection = false;
    }

    if (options.saveSelection && options.textEditor) {
        [options.title, options.content] = parseSelectedHtml(options.textEditor.getSelectedHtml());
    }

    const parentNoteUrl = options.parentNoteUrl;
    const parentNoteId = treeService.getNoteIdFromUrl(parentNoteUrl);

    if (options.type === "mermaid" && !options.content && !options.templateNoteId) {
        options.content = `graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;`;
    }

    const query =
        options.target === "into"
            ? `target=${options.target}`
            : `target=${options.target}&targetBranchId=${options.targetBranchId}`;

    const { note, branch } = await server.post<Response>(`notes/${parentNoteId}/children?${query}`, {
        title: options.title,
        content: options.content || "",
        isProtected: options.isProtected,
        type: options.type,
        mime: options.mime,
        templateNoteId: options.templateNoteId
    });

    if (options.saveSelection) {
        // we remove the selection only after it was saved to server to make sure we don't lose anything
        options.textEditor?.removeSelection();
    }

    await ws.waitForMaxKnownEntityChangeId();

    const activeNoteContext = appContext.tabManager.getActiveContext();
    if (activeNoteContext && options.activate) {
        await activeNoteContext.setNote(`${parentNoteId}/${note.noteId}`);

        if (options.focus === "title") {
            appContext.triggerEvent("focusAndSelectTitle", { isNewNote: true });
        } else if (options.focus === "content") {
            appContext.triggerEvent("focusOnDetail", { ntxId: activeNoteContext.ntxId });
        }
    }

    const noteEntity = await froca.getNote(note.noteId);
    const branchEntity = froca.getBranch(branch.branchId);

    return {
        note: noteEntity,
        branch: branchEntity
    };
}


/**
 * Creates a new note inside the user's Inbox.
 *
 * @param {CreateNoteIntoInboxOpts} [options] - Optional settings such as title, type, template, or content.
 * @returns {Promise<{ note: FNote | null; branch: FBranch | undefined }>}
 * Resolves with the created note and its branch, or `{ note: null, branch: undefined }` if the inbox is missing.
 */
async function createNoteIntoInbox(
    options: CreateNoteIntoInboxOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {
    const inboxNote = await dateNoteService.getInboxNote();
    if (!inboxNote) {
        console.warn("Missing inbox note.");
        // always return a defined object
        return { note: null, branch: undefined };
    }

    if (options.isProtected === undefined) {
        options.isProtected =
            inboxNote.isProtected && protectedSessionHolder.isProtectedSessionAvailable();
    }

    const result = await createNoteWithUrl(
        {
            ...options,
            target: "into",
            parentNoteUrl: inboxNote.noteId,
        }
    );

    return result;
}

async function chooseNoteType() {
    return new Promise<ChooseNoteTypeResponse>((res) => {
        appContext.triggerCommand("chooseNoteType", { callback: res });
    });
}

/* If the first element is heading, parse it out and use it as a new heading. */
function parseSelectedHtml(selectedHtml: string) {
    const dom = $.parseHTML(selectedHtml);

    // TODO: tagName and outerHTML appear to be missing.
    //@ts-ignore
    if (dom.length > 0 && dom[0].tagName && dom[0].tagName.match(/h[1-6]/i)) {
        const title = $(dom[0]).text();
        // remove the title from content (only first occurrence)
        // TODO: tagName and outerHTML appear to be missing.
        //@ts-ignore
        const content = selectedHtml.replace(dom[0].outerHTML, "");

        return [title, content];
    } else {
        return [null, selectedHtml];
    }
}

async function duplicateSubtree(noteId: string, parentNotePath: string) {
    const parentNoteId = treeService.getNoteIdFromUrl(parentNotePath);
    const { note } = await server.post<DuplicateResponse>(`notes/${noteId}/duplicate/${parentNoteId}`);

    await ws.waitForMaxKnownEntityChangeId();

    appContext.tabManager.getActiveContext()?.setNote(`${parentNotePath}/${note.noteId}`);

    const origNote = await froca.getNote(noteId);
    toastService.showMessage(t("note_create.duplicated", { title: origNote?.title }));
}

export default {
    createNote,
    duplicateSubtree,
};
