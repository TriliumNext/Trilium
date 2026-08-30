import branchService from "./branches.js";
import toastService from "./toast.js";
import froca from "./froca.js";
import { copyHtml } from "./clipboard_ext.js";
import linkService from "./link.js";
import { t } from "./i18n.js";
import { throwError } from "./ws.js";

let clipboardBranchIds: string[] = [];
let clipboardMode: string | null = null;

async function pasteAfter(afterBranchId: string) {
    if (isClipboardEmpty()) {
        return;
    }

    if (clipboardMode === "cut") {
        await branchService.moveAfterBranch(clipboardBranchIds, afterBranchId);

        clipboardBranchIds = [];
        clipboardMode = null;
    } else if (clipboardMode === "copy") {
        const clipboardBranches = clipboardBranchIds.map((branchId) => froca.getBranch(branchId));

        for (const clipboardBranch of clipboardBranches) {
            /* v8 ignore next 3 -- isClipboardEmpty() already filtered out non-existent branches, so this is defensive */
            if (!clipboardBranch) {
                continue;
            }

            const clipboardNote = await clipboardBranch.getNote();
            if (!clipboardNote) {
                continue;
            }

            await branchService.cloneNoteAfter(clipboardNote.noteId, afterBranchId);
        }

        // copy will keep clipboardBranchIds and clipboardMode, so it's possible to paste into multiple places
    /* v8 ignore start -- clipboardMode is only ever set to "cut"/"copy" while the clipboard is non-empty */
    } else {
        throwError(`Unrecognized clipboard mode=${clipboardMode}`);
    }
    /* v8 ignore stop */
}

async function pasteInto(parentBranchId: string) {
    if (isClipboardEmpty()) {
        return;
    }

    if (clipboardMode === "cut") {
        await branchService.moveToParentNote(clipboardBranchIds, parentBranchId);

        clipboardBranchIds = [];
        clipboardMode = null;
    } else if (clipboardMode === "copy") {
        const clipboardBranches = clipboardBranchIds.map((branchId) => froca.getBranch(branchId));

        for (const clipboardBranch of clipboardBranches) {
            /* v8 ignore next 3 -- isClipboardEmpty() already filtered out non-existent branches, so this is defensive */
            if (!clipboardBranch) {
                continue;
            }

            const clipboardNote = await clipboardBranch.getNote();
            if (!clipboardNote) {
                continue;
            }

            await branchService.cloneNoteToBranch(clipboardNote.noteId, parentBranchId);
        }

        // copy will keep clipboardBranchIds and clipboardMode, so it's possible to paste into multiple places
    /* v8 ignore start -- clipboardMode is only ever set to "cut"/"copy" while the clipboard is non-empty */
    } else {
        throwError(`Unrecognized clipboard mode=${clipboardMode}`);
    }
    /* v8 ignore stop */
}

async function copy(branchIds: string[]) {
    clipboardBranchIds = branchIds;
    clipboardMode = "copy";

    // Reference links go onto the system clipboard as well, so the notes can be pasted into the
    // content of another note. https://github.com/zadam/trilium/issues/2401
    const htmlParts: string[] = [];
    const textParts: string[] = [];

    for (const branch of froca.getBranches(clipboardBranchIds)) {
        const $link = await linkService.createLink(`${branch.parentNoteId}/${branch.noteId}`, { referenceLink: true });
        htmlParts.push($link[0].outerHTML);
        textParts.push($link.text());
    }

    // The notes sit on Trilium's own clipboard either way, so a refused system clipboard only costs
    // the ability to paste them into a note's content.
    const linksCopied = htmlParts.length === 0 || (await copyHtml(htmlParts.join(", "), textParts.join(", ")));

    if (linksCopied) {
        toastService.showMessage(t("clipboard.copied"));
    } else {
        toastService.showMessage(t("clipboard.copied_without_links"), 5000, "bx bx-error");
    }
}

function cut(branchIds: string[]) {
    clipboardBranchIds = branchIds;

    if (clipboardBranchIds.length > 0) {
        clipboardMode = "cut";

        toastService.showMessage(t("clipboard.cut"));
    }
}

function isClipboardEmpty() {
    clipboardBranchIds = clipboardBranchIds.filter((branchId) => !!froca.getBranch(branchId));

    return clipboardBranchIds.length === 0;
}

export default {
    pasteAfter,
    pasteInto,
    cut,
    copy,
    isClipboardEmpty
};
