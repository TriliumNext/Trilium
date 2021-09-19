import appContext from "./app_context.js";
import utils from "./utils.js";
import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";
import ws from "./ws.js";
import treeCache from "./tree_cache.js";
import treeService from "./tree.js";
import toastService from "./toast.js";

async function createNote(parentNotePath, options = {}) {
    options = Object.assign({
        activate: true,
        focus: 'title',
        target: 'into'
    }, options);

    // if isProtected isn't available (user didn't enter password yet), then note is created as unencrypted
    // but this is quite weird since user doesn't see WHERE the note is being created so it shouldn't occur often
    if (!options.isProtected || !protectedSessionHolder.isProtectedSessionAvailable()) {
        options.isProtected = false;
    }

    if (appContext.tabManager.getActiveTabNoteType() !== 'text') {
        options.saveSelection = false;
    }

    if (options.saveSelection && utils.isCKEditorInitialized()) {
        [options.title, options.content] = parseSelectedHtml(window.cutToNote.getSelectedHtml());
    }

    const newNoteName = options.title || "new note";

    const parentNoteId = treeService.getNoteIdFromNotePath(parentNotePath);

    const {note, branch} = await server.post(`notes/${parentNoteId}/children?target=${options.target}&targetBranchId=${options.targetBranchId}`, {
        title: newNoteName,
        content: options.content || "",
        isProtected: options.isProtected,
        type: options.type,
        mime: options.mime
    });

    if (options.saveSelection && utils.isCKEditorInitialized()) {
        // we remove the selection only after it was saved to server to make sure we don't lose anything
        window.cutToNote.removeSelection();
    }

    await ws.waitForMaxKnownEntityChangeId();

    if (options.activate) {
        const activeTabContext = appContext.tabManager.getActiveTabContext();
        await activeTabContext.setNote(`${parentNotePath}/${note.noteId}`);

        if (options.focus === 'title') {
            appContext.triggerEvent('focusAndSelectTitle');
        }
        else if (options.focus === 'content') {
            appContext.triggerEvent('focusOnDetail', {tabId: activeTabContext.tabId});
        }
    }

    const noteEntity = await treeCache.getNote(note.noteId);
    const branchEntity = treeCache.getBranch(branch.branchId);

    return {
        note: noteEntity,
        branch: branchEntity
    };
}

/* If first element is heading, parse it out and use it as a new heading. */
function parseSelectedHtml(selectedHtml) {
    const dom = $.parseHTML(selectedHtml);

    if (dom.length > 0 && dom[0].tagName && dom[0].tagName.match(/h[1-6]/i)) {
        const title = $(dom[0]).text();
        // remove the title from content (only first occurence)
        const content = selectedHtml.replace(dom[0].outerHTML, "");

        return [title, content];
    }
    else {
        return [null, selectedHtml];
    }
}

async function duplicateSubtree(noteId, parentNotePath) {
    const parentNoteId = treeService.getNoteIdFromNotePath(parentNotePath);
    const {note} = await server.post(`notes/${noteId}/duplicate/${parentNoteId}`);

    await ws.waitForMaxKnownEntityChangeId();

    const activeTabContext = appContext.tabManager.getActiveTabContext();
    activeTabContext.setNote(`${parentNotePath}/${note.noteId}`);

    const origNote = await treeCache.getNote(noteId);
    toastService.showMessage(`Note "${origNote.title}" has been duplicated`);
}

export default {
    createNote,
    duplicateSubtree
};
