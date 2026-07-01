"use strict";

import { getBecca } from "../../becca/becca.js";
import keyboard_actions from "../../services/keyboard_actions";

function getKeyboardActions() {
    return keyboard_actions.getKeyboardActions();
}

function getShortcutsForNotes() {
    const labels = getBecca().findAttributes("label", "keyboardShortcut");

    // launchers have different handling
    return labels.filter((attr) => getBecca().getNote(attr.noteId)?.type !== "launcher");
}

export default {
    getKeyboardActions,
    getShortcutsForNotes
};
