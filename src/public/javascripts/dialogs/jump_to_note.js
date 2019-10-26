import treeService from '../services/tree.js';
import searchNotesService from '../services/search_notes.js';
import noteAutocompleteService from '../services/note_autocomplete.js';
import utils from "../services/utils.js";
import keys from "../services/keybindings.js";

const $dialog = $("#jump-to-note-dialog");
const $autoComplete = $("#jump-to-note-autocomplete");
const $showInFullTextButton = $("#show-in-full-text-button");

export async function showDialog() {
    utils.closeActiveDialog();

    glob.activeDialog = $dialog;

    $autoComplete.val('');

    $dialog.modal();

    noteAutocompleteService.initNoteAutocomplete($autoComplete, { hideGoToSelectedNoteButton: true })
        .on('autocomplete:selected', function(event, suggestion, dataset) {
            if (!suggestion.path) {
                return false;
            }

            treeService.activateNote(suggestion.path);
        });

    noteAutocompleteService.showRecentNotes($autoComplete);
}

function showInFullText(e) {
    // stop from propagating upwards (dangerous especially with ctrl+enter executable javascript notes)
    e.preventDefault();
    e.stopPropagation();

    const searchText = $autoComplete.val();

    searchNotesService.resetSearch();
    searchNotesService.showSearch();
    searchNotesService.doSearch(searchText);

    $dialog.modal('hide');
}


$showInFullTextButton.click(showInFullText);

keys.bindTo($dialog, keys.actions.JumpToNote, showInFullText);
