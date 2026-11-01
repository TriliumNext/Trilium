import type { LineOperation, LineOperationOptions, TextTransform } from "@triliumnext/commons";

import type { CommandNames } from "../components/app_context.js";
import { t } from "../services/i18n.js";
import options from "../services/options.js";
import { resolveContentLanguage } from "../utils/formatters.js";
import type { MenuCommandItem, MenuItem } from "./context_menu.js";
import { submenuItem } from "./context_menu_utils.js";

/**
 * The text tools of a code editor's right-click menu, which change the selected lines or text:
 * a _Transform_ submenu with the line operations, the whitespace removals and the text
 * transforms. Its rows are disabled while nothing is selected.
 *
 * Returns `null` when `element` is not in an editable code editor.
 */
export async function buildCodeEditorContextMenuItems(
    element: Element | null | undefined
): Promise<MenuItem<CommandNames>[] | null> {
    const root = element?.closest(".cm-editor");
    if (!(root instanceof HTMLElement)) {
        return null;
    }

    // Imported here: the menu is set up at startup, and a code editor loads CodeMirror later.
    const {
        default: CodeMirror, hasSelectedText, runLineOperation, runTextTransform
    } = await import("@triliumnext/codemirror");
    const editor = CodeMirror.findFromDOM(root);
    if (!(editor instanceof CodeMirror) || editor.state.readOnly) {
        return null;
    }

    const isEnabled = hasSelectedText(editor.state);
    const toolOptions = getTextToolOptions();
    const lineItem = (
        title: string, operation: LineOperation, tooltip?: string
    ): MenuCommandItem<CommandNames> => ({
        title,
        tooltip,
        enabled: isEnabled,
        handler: () => {
            runLineOperation(editor, operation, toolOptions);
            editor.focus();
        }
    });
    const transformItem = (
        title: string, transform: TextTransform
    ): MenuCommandItem<CommandNames> => ({
        title,
        enabled: isEnabled,
        handler: () => {
            runTextTransform(editor, transform, toolOptions);
            editor.focus();
        }
    });

    const transform: MenuItem<CommandNames>[] = [
        lineItem(t("code_editor_context_menu.sort_ascending"), "sortAscending"),
        lineItem(t("code_editor_context_menu.sort_descending"), "sortDescending"),
        lineItem(t("code_editor_context_menu.shuffle_lines"), "shuffle"),
        lineItem(t("code_editor_context_menu.reverse_lines"), "reverse"),
        lineItem(t("code_editor_context_menu.deduplicate_lines"), "deduplicate"),
        { kind: "separator" },
        lineItem(t("code_editor_context_menu.trim_leading"), "trimLeading",
            t("code_editor_context_menu.trim_leading_tooltip")),
        lineItem(t("code_editor_context_menu.trim_trailing"), "trimTrailing",
            t("code_editor_context_menu.trim_trailing_tooltip")),
        lineItem(t("code_editor_context_menu.trim_both"), "trimBoth",
            t("code_editor_context_menu.trim_both_tooltip")),
        lineItem(t("code_editor_context_menu.remove_blank_lines"), "removeBlankLines"),
        { kind: "separator" },
        transformItem(t("code_editor_context_menu.to_uppercase"), "upperCase"),
        transformItem(t("code_editor_context_menu.to_lowercase"), "lowerCase"),
        transformItem(t("code_editor_context_menu.to_sentence_case"), "sentenceCase"),
        transformItem(t("code_editor_context_menu.to_title_case"), "titleCase"),
        transformItem(t("code_editor_context_menu.remove_diacritics"), "removeDiacritics")
    ];

    return [
        submenuItem({ title: t("code_editor_context_menu.transform"), uiIcon: "bx bx-text" },
            transform)
    ];
}

/** The locale of the note content, and the user's own date format for sorting by date. */
function getTextToolOptions(): LineOperationOptions {
    const customDateTimeFormat = options.get("customDateTimeFormat");
    return {
        locale: resolveContentLanguage(null) ?? undefined,
        dateFormats: customDateTimeFormat ? [ customDateTimeFormat ] : []
    };
}
