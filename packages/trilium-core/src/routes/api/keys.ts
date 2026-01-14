"use strict";

import becca from "../../becca/becca";
import keyboard_actions from "../../services/keyboard_actions";

function getKeyboardActions() {
    return keyboard_actions.getKeyboardActions();
}

function getShortcutsForNotes() {
    const labels = becca.findAttributes("label", "keyboardShortcut");

    // launchers have different handling
    return labels.filter((attr) => becca.getNote(attr.noteId)?.type !== "launcher");
}

export default {
    getKeyboardActions,
    getShortcutsForNotes
};
