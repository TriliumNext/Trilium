import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { AttributeRow } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import type FBranch from "../entities/fbranch.js";
import type FNote from "../entities/fnote.js";
import type { ChooseNoteTypeResponse } from "../widgets/dialogs/note_type_chooser.js";
import branchService from "./branches.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";
import toastService from "./toast.js";
import treeService from "./tree.js";
import ws from "./ws.js";

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
    /**
     * Parents the created note is cloned into, in addition to the one it is created under. Set from
     * a template's `~template:newNoteDefaultParent` relations; all resulting branches are equal.
     */
    cloneToNoteIds?: string[];
    /** Attributes to be set on the note. These are set atomically on note creation, so entity changes are not sent for attributes defined here. */
    attributes?: Omit<AttributeRow, "noteId" | "attributeId">[];
    /**
     * Note context to activate the new note in. Popup dialogs (quick edit, tree popup) pass their
     * own context here — it lives outside the tab manager, so defaulting to the active tab would
     * activate the note in the background and close the dialog. When set, the surrounding dialog
     * is kept open.
     */
    noteContext?: NoteContext;
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

async function createNote(parentNotePath: string | undefined, options: CreateNoteOpts = {}, componentId?: string) {
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

    // Whether there is a selection to save is the editor's answer, not the tab manager's: the editor
    // handing us the selection is not necessarily the active tab's (a split, the quick editor, an
    // embedded pane). An empty selection means there is nothing to cut, so the note is created as an
    // ordinary empty child and the source note is left untouched.
    const selectedHtml = options.saveSelection ? options.textEditor?.getSelectedHtml() : null;
    if (selectedHtml) {
        [options.title, options.content] = parseSelectedHtml(selectedHtml);
    } else {
        options.saveSelection = false;
    }

    const parentNoteId = treeService.getNoteIdFromUrl(parentNotePath);

    const { note, branch } = await server.post<Response>(`notes/${parentNoteId}/children?target=${options.target}&targetBranchId=${options.targetBranchId || ""}`, {
        title: options.title,
        content: options.content || "",
        isProtected: options.isProtected,
        type: options.type,
        mime: options.mime,
        templateNoteId: options.templateNoteId,
        attributes: options.attributes
    }, componentId);

    if (options.saveSelection) {
        // we remove the selection only after it was saved to server to make sure we don't lose anything
        options.textEditor?.removeSelection();
    }

    for (const cloneParentNoteId of options.cloneToNoteIds ?? []) {
        await branchService.cloneNoteToParentNote(note.noteId, cloneParentNoteId);
    }

    await ws.waitForMaxKnownEntityChangeId();

    const activeNoteContext = options.noteContext ?? appContext.tabManager.getActiveContext();
    if (activeNoteContext && options.activate) {
        await activeNoteContext.setNote(`${parentNotePath}/${note.noteId}`, {
            keepActiveDialog: !!options.noteContext
        });

        if (options.focus === "title") {
            appContext.triggerEvent("focusAndSelectTitle", { isNewNote: true, ntxId: activeNoteContext.ntxId });
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
 * Prompts for the type / template of a new note and, optionally, a parent. When the user picks a
 * template without picking a parent, the note goes to the template's `~template:newNoteDefaultParent`
 * targets (if any) instead, so a template gathers the notes created from it in one place: one target
 * is returned as the `notePath` to create under, the rest as `cloneToNoteIds` to clone into.
 */
async function chooseNoteType() {
    const response = await new Promise<ChooseNoteTypeResponse>((res) => {
        appContext.triggerCommand("chooseNoteType", { callback: res });
    });

    if (response.success && !response.notePath && response.templateNoteId) {
        const defaultParents = await getTemplateDefaultParents(response.templateNoteId);
        if (defaultParents) {
            response.notePath = defaultParents.notePath;
            response.cloneToNoteIds = defaultParents.cloneToNoteIds;
        }
    }

    return response;
}

async function createNoteWithTypePrompt(parentNotePath: string, options: CreateNoteOpts = {}) {
    const { success, noteType, templateNoteId, notePath, cloneToNoteIds } = await chooseNoteType();

    if (!success) {
        return;
    }

    options.type = noteType;
    options.templateNoteId = templateNoteId;
    options.cloneToNoteIds = cloneToNoteIds;

    return await createNote(notePath || parentNotePath, options);
}

/**
 * Resolves the targets of the template's `~template:newNoteDefaultParent` relations. The note is
 * placed in every target: created under the first resolvable one (`notePath`, relative to the
 * current hoisting) and cloned into the rest (`cloneToNoteIds`) — the split is only how the API is
 * called, since all branches of a note are equal. Owned relations replace inherited ones, so a
 * template overrides an inheritable default on an ancestor instead of adding to it. Undefined when
 * no target resolves to a note with a visible path.
 *
 * Inherited relations count only when owned by an ancestor of the template, i.e. inherited through
 * the tree. Attributes also flow through `~template` — with their inheritable flag intact — and
 * every note created from a template carries `~template`, so neither the flag nor mere presence in
 * `getRelations()` proves tree inheritance; without the ancestry check, a note created from a
 * template and later marked `#template` itself would silently adopt the original template's
 * destination.
 */
async function getTemplateDefaultParents(templateNoteId: string) {
    const templateNote = await froca.getNote(templateNoteId);
    if (!templateNote) {
        return undefined;
    }

    const ownedRelations = templateNote.getOwnedRelations("template:newNoteDefaultParent");
    const ancestorNoteIds = new Set(templateNote.getAllNotePaths().flat());
    ancestorNoteIds.delete(templateNote.noteId);
    const relations = ownedRelations.length
        ? ownedRelations
        : templateNote.getRelations("template:newNoteDefaultParent")
            .filter((attr) => attr.isInheritable && ancestorNoteIds.has(attr.noteId));
    const targetNoteIds = [...new Set(relations.map((relation) => relation.value).filter(Boolean))];
    const targetNotes = await froca.getNotes(targetNoteIds, true);
    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;

    const notePath = targetNotes[0]?.getBestNotePathString(hoistedNoteId);
    if (!notePath) {
        return undefined;
    }

    return {
        notePath,
        cloneToNoteIds: targetNotes.slice(1).map((targetNote) => targetNote.noteId)
    };
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
    }
    return [null, selectedHtml];
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
    createNoteWithTypePrompt,
    duplicateSubtree,
    chooseNoteType
};
