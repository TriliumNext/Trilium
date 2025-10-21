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
import { CreateChildrenResponse } from "@triliumnext/commons";

// // Creating a note at a path creates ambiguity, do we want it created Into or
// // Next to as sibling?
// // TODO: where the heck is this defined
// export enum NotePlacement {
//     Into = "into",
//     After = "after"
// }
export enum CreateNoteTarget {
    IntoNoteURL,
    AfterNoteURL,
    BeforeNoteURL,
    IntoInbox,
}

export type BaseCreateNoteOpts =
  | ({
      promptForType: true;
      type?: never;
    } & BaseCreateNoteSharedOpts)
  | ({
      promptForType?: false;
      type?: string;
    } & BaseCreateNoteSharedOpts);

export interface BaseCreateNoteSharedOpts {
    target: CreateNoteTarget;
    isProtected?: boolean;
    saveSelection?: boolean;
    title?: string | null;
    content?: string | null;
    type?: string;
    mime?: string;
    templateNoteId?: string;
    activate?: boolean;
    focus?: "title" | "content";
    targetBranchId?: string;
    textEditor?: CKTextEditor;
}

// For creating *in a specific path*
type CreateNoteAtURLOpts = BaseCreateNoteSharedOpts & {
    // Url is either path or Id
    parentNoteUrl: string;
}

export type CreateNoteIntoURLOpts = CreateNoteAtURLOpts;

// targetBranchId disambiguates the position for cloned notes, thus it must
// only be specified for a sibling
// This is also specified in the backend
type CreateNoteSiblingURLOpts = Omit<CreateNoteAtURLOpts, "targetBranchId"> & {
    targetBranchId: string;
};
export type CreateNoteBeforeURLOpts = CreateNoteSiblingURLOpts;
export type CreateNoteAfterURLOpts = CreateNoteSiblingURLOpts;

// For creating *in the inbox*
export type CreateNoteIntoInboxURLOpts = BaseCreateNoteSharedOpts & {
    // disallowed
    parentNoteUrl?: never;
}

interface Response {
    // TODO: Deduplicate with server once we have client/server architecture.
    note: FNote;
    branch: FBranch;
}

interface DuplicateResponse {
    // TODO: Deduplicate with server once we have client/server architecture.
    note: FNote;
}

/**
 * Core function that creates a new note under the specified parent note path.
 *
 * @param target - Duplicates apps/server/src/routes/api/notes.ts createNote
 * @param {BaseCreateNoteSharedOpts} [options] - Options controlling note creation (title, content, type, template, focus, etc.).
 * with parentNotePath - The parent note path where the new note will be created.
 * @returns {Promise<{ note: FNote | null; branch: FBranch | undefined }>}
 * Resolves with the created note and branch entities.
 */
async function createNoteAtNote(
    target: "into" | "after" | "before",
    options: CreateNoteAtURLOpts
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

    const { note, branch } = await server.post<Response>(`notes/${parentNoteId}/children?target=${target}&targetBranchId=${options.targetBranchId || ""}`, {
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

async function createNoteIntoNote(
    options: CreateNoteIntoURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {
    return createNoteAtNote("into", {...options} as CreateNoteAtURLOpts);
}

async function createNoteBeforeNote(
    options: CreateNoteBeforeURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {
    return createNoteAtNote("before", {...options} as CreateNoteAtURLOpts);
}

async function createNoteAfterNote(
    options: CreateNoteAfterURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {
    return createNoteAtNote("after", {...options} as CreateNoteAtURLOpts);
}

/**
 * Creates a new note inside the user's Inbox.
 *
 * @param {BaseCreateNoteSharedOpts} [options] - Optional settings such as title, type, template, or content.
 * @returns {Promise<{ note: FNote | null; branch: FBranch | undefined }>}
 * Resolves with the created note and its branch, or `{ note: null, branch: undefined }` if the inbox is missing.
 */
async function createNoteIntoInbox(
    options: CreateNoteIntoInboxURLOpts
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

    const result = await createNoteIntoNote(
        {
            ...options,
            parentNoteUrl: inboxNote.noteId,
        } as CreateNoteIntoURLOpts
    );

    return result;
}

async function chooseNoteType() {
    return new Promise<ChooseNoteTypeResponse>((res) => {
        appContext.triggerCommand("chooseNoteType", { callback: res });
    });
}

async function createNote(
  options: CreateNoteIntoURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }>;

async function createNote(
  options: CreateNoteAfterURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }>;

async function createNote(
  options: CreateNoteBeforeURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }>;

async function createNote(
  options: CreateNoteIntoInboxURLOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }>;

async function createNote(
  options: BaseCreateNoteOpts
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {

    let resolvedOptions = { ...options };

    // handle prompts centrally to write once fix for all
    if (options.promptForType) {
        const { success, noteType, templateNoteId, notePath } = await chooseNoteType();

        if (!success) return {
            note: null, branch: undefined
        };

        resolvedOptions = {
            ...resolvedOptions,
            promptForType: false,
            type: noteType,
            templateNoteId,
        } as BaseCreateNoteOpts;

        if (notePath) {
            resolvedOptions = resolvedOptions as CreateNoteIntoURLOpts;
            resolvedOptions = {
                ...resolvedOptions,
                target: CreateNoteTarget.IntoNoteURL,
                parentNoteUrl: notePath,
            } as CreateNoteIntoURLOpts;
        }
    }

    switch (resolvedOptions.target) {
        case CreateNoteTarget.IntoNoteURL:
            return await createNoteIntoNote(resolvedOptions as CreateNoteIntoURLOpts);

        case CreateNoteTarget.BeforeNoteURL:
            return await createNoteBeforeNote(resolvedOptions as CreateNoteBeforeURLOpts);

        case CreateNoteTarget.AfterNoteURL:
            return await createNoteAfterNote(resolvedOptions as CreateNoteAfterURLOpts);

        case CreateNoteTarget.IntoInbox:
            return await createNoteIntoInbox(resolvedOptions as CreateNoteIntoInboxURLOpts);

        default: {
            console.warn("[createNote] Unknown target:", options.target, resolvedOptions);
            toastService.showMessage("Unknown note creation target."); // optional
            return { note: null, branch: undefined };
        }
    }
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
