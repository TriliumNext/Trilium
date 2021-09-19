import server from "../services/server.js";
import treeCache from "../services/tree_cache.js";
import linkService from "../services/link.js";
import utils from "../services/utils.js";

const $dialog = $("#delete-notes-dialog");
const $okButton = $("#delete-notes-dialog-ok-button");
const $cancelButton = $("#delete-notes-dialog-cancel-button");
const $deleteNotesList = $("#delete-notes-list");
const $brokenRelationsList = $("#broken-relations-list");
const $deletedNotesCount = $("#deleted-notes-count");
const $noNoteToDeleteWrapper = $("#no-note-to-delete-wrapper");
const $deleteNotesListWrapper = $("#delete-notes-list-wrapper");
const $brokenRelationsListWrapper = $("#broken-relations-wrapper");
const $brokenRelationsCount = $("#broke-relations-count");
const $deleteAllClones = $("#delete-all-clones");

let branchIds = null;
let resolve = null;

async function renderDeletePreview() {
    const response = await server.post('delete-notes-preview', {
        branchIdsToDelete: branchIds,
        deleteAllClones: isDeleteAllClonesChecked()
    });

    $deleteNotesList.empty();
    $brokenRelationsList.empty();

    $deleteNotesListWrapper.toggle(response.noteIdsToBeDeleted.length > 0);
    $noNoteToDeleteWrapper.toggle(response.noteIdsToBeDeleted.length === 0);

    for (const note of await treeCache.getNotes(response.noteIdsToBeDeleted)) {
        $deleteNotesList.append(
            $("<li>").append(
                await linkService.createNoteLink(note.noteId, {showNotePath: true})
            )
        );
    }

    $deletedNotesCount.text(response.noteIdsToBeDeleted.length);

    $brokenRelationsListWrapper.toggle(response.brokenRelations.length > 0);
    $brokenRelationsCount.text(response.brokenRelations.length);

    await treeCache.getNotes(response.brokenRelations.map(br => br.noteId));

    for (const attr of response.brokenRelations) {
        $brokenRelationsList.append(
            $("<li>")
                .append(`Note `)
                .append(await linkService.createNoteLink(attr.value))
                .append(` (to be deleted) is referenced by relation <code>${attr.name}</code> originating from `)
                .append(await linkService.createNoteLink(attr.noteId))
        );
    }
}

export async function showDialog(branchIdsToDelete) {
    branchIds = branchIdsToDelete;

    await renderDeletePreview();

    utils.openDialog($dialog);

    return new Promise((res, rej) => resolve = res);
}

export function isDeleteAllClonesChecked() {
    return $deleteAllClones.is(":checked");
}

$dialog.on('shown.bs.modal', () => $okButton.trigger("focus"));

$cancelButton.on('click', () => {
    utils.closeActiveDialog();

    resolve({proceed: false});
});

$okButton.on('click', () => {
    utils.closeActiveDialog();

    resolve({
        proceed: true,
        deleteAllClones: isDeleteAllClonesChecked()
    });
});

$deleteAllClones.on('click', () => renderDeletePreview());
