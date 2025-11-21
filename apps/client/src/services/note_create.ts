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
import { CreateNoteAction } from "@triliumnext/commons";

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
 *   - CreateNoteIntoDefaultOpts
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
export type CreateNoteWithLinkOpts =
    | (CreateNoteBase & {
          target: "into";
          parentNoteLink?: string;
          // No branch ID needed for "into"
      })
    | (CreateNoteBase & {
          target: "before" | "after";
          // Either an Url or a Path
          parentNoteLink?: string;
          // Required for "before"/"after"
          targetBranchId: string;
      });

export type CreateNoteIntoDefaultOpts = CreateNoteBase & {
    target: "default";
    parentNoteLink?: never;
};

export type CreateNoteOpts = CreateNoteWithLinkOpts | CreateNoteIntoDefaultOpts;

interface Response {
    // TODO: Deduplicate with server once we have client/server architecture.
    note: FNote;
    branch: FBranch;
}

interface DuplicateResponse {
    // TODO: Deduplicate with server once we have client/server architecture.
    note: FNote;
}

// The low level note creation
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
        case "default":
            return createNoteIntoDefaultLocation(resolvedOptions);
        case "into":
        case "before":
        case "after":
            return createNoteWithLink(resolvedOptions);
    }
}

// A wrapper to standardize note creation
async function createNoteFromAction(
    action: CreateNoteAction,
    promptForType: boolean,
    title: string | undefined,
    parentNoteLink: string | undefined,
): Promise<{ note: FNote | null; branch: FBranch | undefined }> {
    switch (action) {
        case CreateNoteAction.CreateNote: {
            const resp = await createNote(
                {
                    target: "default",
                    title: title,
                    activate: true,
                    promptForType,
                }
            );
            return resp;
        }
        case CreateNoteAction.CreateAndLinkNote: {
            const resp = await createNote(
                {
                    target: "default",
                    title,
                    activate: false,
                    promptForType,
                }
            );
            return resp;
        }
        case CreateNoteAction.CreateChildNote: {
            if (!parentNoteLink) {
                console.warn("Missing parentNoteLink in createNoteFromCkEditor()");
                return { note: null, branch: undefined };
            }

            const resp = await createNote(
                {
                    target: "into",
                    parentNoteLink,
                    title,
                    activate: true,
                    promptForType,
                },
            );
            return resp
        }
        case CreateNoteAction.CreateAndLinkChildNote: {
            if (!parentNoteLink) {
                console.warn("Missing parentNoteLink in createNoteFromCkEditor()");
                return { note: null, branch: undefined };
            }
            const resp = await createNote(
                {
                    target: "into",
                    parentNoteLink: parentNoteLink,
                    title,
                    activate: false,
                    promptForType,
                },
            )
            return resp;
        }

        default:
            console.warn("Unknown CreateNoteAction:", action);
            return { note: null, branch: undefined };
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
            parentNoteLink: notePath,
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
async function createNoteWithLink(
    options: CreateNoteWithLinkOpts
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

    const parentNoteLink = options.parentNoteLink;
    const parentNoteId = treeService.getNoteIdFromLink(parentNoteLink);

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
 * @param {CreateNoteIntoDefaultOpts} [options] - Optional settings such as title, type, template, or content.
 * @returns {Promise<{ note: FNote | null; branch: FBranch | undefined }>}
 * Resolves with the created note and its branch, or `{ note: null, branch: undefined }` if the inbox is missing.
 */
async function createNoteIntoDefaultLocation(
    options: CreateNoteIntoDefaultOpts
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

    const result = await createNoteWithLink(
        {
            ...options,
            target: "into",
            parentNoteLink: inboxNote.noteId,
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
    const parentNoteId = treeService.getNoteIdFromLink(parentNotePath);
    const { note } = await server.post<DuplicateResponse>(`notes/${noteId}/duplicate/${parentNoteId}`);

    await ws.waitForMaxKnownEntityChangeId();

    appContext.tabManager.getActiveContext()?.setNote(`${parentNotePath}/${note.noteId}`);

    const origNote = await froca.getNote(noteId);
    toastService.showMessage(t("note_create.duplicated", { title: origNote?.title }));
}

export default {
    createNote,
    createNoteFromAction,
    duplicateSubtree,
};
