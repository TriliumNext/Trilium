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

export interface CreateNoteOpts {
    isProtected?: boolean;
    saveSelection?: boolean;
    title?: string | null;
    content?: string | null;
    type?: string;
    mime?: string;
    templateNoteId?: string;
    activate?: boolean;
    focus?: "title" | "content";
    target?: string;
    targetBranchId?: string;
    textEditor?: CKTextEditor;
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
 * Creates a new note inside the user's Inbox.
 *
 * @param {CreateNoteOpts} [options] - Optional settings such as title, type, template, or content.
 * @returns {Promise<{ note: FNote | null; branch: FBranch | undefined }>}
 * Resolves with the created note and its branch, or `{ note: null, branch: undefined }` if the inbox is missing.
 */
async function createNoteIntoInbox(
    options: CreateNoteOpts = {}
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

    const result = await createNoteIntoPath(inboxNote.noteId, {
        ...options,
        target: "into",
    });

    return result;
}
/**
 * Core function that creates a new note under the specified parent note path.
 *
 * @param {string | undefined} parentNotePath - The parent note path where the new note will be created.
 * @param {CreateNoteOpts} [options] - Options controlling note creation (title, content, type, template, focus, etc.).
 * @returns {Promise<{ note: FNote | null; branch: FBranch | undefined }>}
 * Resolves with the created note and branch entities.
 */
async function createNoteIntoPath(
    parentNotePath: string | undefined,
    options: CreateNoteOpts = {}
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

    const parentNoteId = treeService.getNoteIdFromUrl(parentNotePath);

    if (options.type === "mermaid" && !options.content && !options.templateNoteId) {
        options.content = `graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;`;
    }

    const { note, branch } = await server.post<Response>(`notes/${parentNoteId}/children?target=${options.target}&targetBranchId=${options.targetBranchId || ""}`, {
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
        await activeNoteContext.setNote(`${parentNotePath}/${note.noteId}`);

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

async function chooseNoteType() {
    return new Promise<ChooseNoteTypeResponse>((res) => {
        appContext.triggerCommand("chooseNoteType", { callback: res });
    });
}

async function createNoteIntoPathWithTypePrompt(parentNotePath: string, options: CreateNoteOpts = {}) {
    const { success, noteType, templateNoteId, notePath } = await chooseNoteType();

    if (!success) {
        return;
    }

    options.type = noteType;
    options.templateNoteId = templateNoteId;

    return await createNoteIntoPath(notePath || parentNotePath, options);
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
    createNoteIntoInbox,
    createNoteIntoPath,
    createNoteIntoPathWithTypePrompt,
    duplicateSubtree,
    chooseNoteType
};
