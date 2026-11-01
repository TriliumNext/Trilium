import bxSortAlt2 from "boxicons/svg/regular/bx-sort-alt-2.svg?raw";
import { Command, Plugin } from "ckeditor5";
import type { Editor } from "ckeditor5";

import { buttonItem, createCommandListDropdown } from "../command_list_dropdown.js";
import TableSort from "../table_sort.js";
import { sortRuns } from "./sort_runs.js";
import { resolveSortTarget, TABLE_SORT_COMMANDS } from "./sort_targets.js";
import type { SortTargetKind } from "./sort_targets.js";

/**
 * Sorts what the selection is in with `autoSort`: the items of a list, sibling blocks, or the rows
 * of a table through `TableSort`. Adds the `sortSelection` split button, whose main part sorts in
 * ascending order.
 */
export default class SortSelection extends Plugin {

    static get requires() {
        // CKEditor loads `TableSort` first, so its commands refresh before these ones read them.
        return [ TableSort ] as const;
    }

    static get pluginName() {
        return "SortSelection" as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;
        editor.commands.add("triliumSortSelectionAscending",
            new SortSelectionCommand(editor, false));
        editor.commands.add("triliumSortSelectionDescending",
            new SortSelectionCommand(editor, true));

        editor.ui.componentFactory.add("sortSelection", (locale) =>
            createCommandListDropdown(this, locale, {
                label: t("Sort"),
                icon: bxSortAlt2,
                splitButtonCommandName: "triliumSortSelectionAscending",
                items: [
                    buttonItem("triliumSortSelectionAscending", t("Ascending")),
                    buttonItem("triliumSortSelectionDescending", t("Descending"))
                ]
            }));
    }

}

export class SortSelectionCommand extends Command {

    /** What a sort reorders, or `null` while the command is disabled. */
    declare value: SortTargetKind | null;

    private readonly isDescending: boolean;

    constructor(editor: Editor, isDescending: boolean) {
        super(editor);
        this.isDescending = isDescending;
    }

    override refresh() {
        const target = resolveSortTarget(this.editor);
        this.value = target?.kind ?? null;
        this.isEnabled = target !== null;
    }

    override execute() {
        const editor = this.editor;
        const target = resolveSortTarget(editor);
        if (!target) {
            return;
        }
        if (target.kind === "rows") {
            editor.execute(this.isDescending
                ? TABLE_SORT_COMMANDS.descending
                : TABLE_SORT_COMMANDS.ascending);
            return;
        }

        // A caret moves with its block. A range is set over the sorted runs, as its ends moved.
        const isRange = !editor.model.document.selection.isCollapsed;
        sortRuns(editor, target.getRuns(), this.isDescending, (writer, sorted) => {
            if (isRange) {
                writer.setSelection(writer.createRange(
                    writer.createPositionBefore(sorted[0].first),
                    writer.createPositionAfter(sorted[sorted.length - 1].last)));
            }
        });
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [SortSelection.pluginName]: SortSelection;
    }

    interface CommandsMap {
        triliumSortSelectionAscending: SortSelectionCommand;
        triliumSortSelectionDescending: SortSelectionCommand;
    }
}
