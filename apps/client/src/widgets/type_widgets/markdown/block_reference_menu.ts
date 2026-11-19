import CodeMirror from "@triliumnext/codemirror";
import { isInCode } from "@triliumnext/codemirror/src/extensions/block_markers";
import { indexMarkdownBlocks } from "@triliumnext/commons/src/lib/markdown_block_index.js";
import { insertHtmlBlock } from "@triliumnext/commons/src/lib/markdown_references.js";

import type { CommandNames } from "../../../components/app_context";
import type { MenuItem } from "../../../menus/context_menu";
import type { ClipboardAccess } from "../../../menus/table_context_menu";
import {
    type BlockReferenceMenuItems, type ClipboardBlockReference, getExcerptHtml,
    pasteClipboardReference
} from "../../../services/block_reference";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import {
    copyMarkdownReference, getMarkdownReferenceSource, getSelectedBlocks, isMarkdownEditor,
    PREVIEW_BLOCK_HOST
} from "./editor_block_references";
import { replaceSelection, toWikilink } from "./editor_utils";

/**
 * The block reference rows for a right-click on `element`, or `null` when `element` is not in an
 * editable editor of Markdown. `clipboard` enables the paste rows. An editor without a note, such
 * as one of a Markdown file, has no copy row.
 */
export async function buildMarkdownReferenceMenuItems(
    element: Element,
    clipboard?: ClipboardAccess
): Promise<BlockReferenceMenuItems | null> {
    const root = element.closest(".cm-editor");
    const view = root instanceof HTMLElement ? CodeMirror.findFromDOM(root) : null;
    if (!(view instanceof CodeMirror) || view.state.readOnly || !isMarkdownEditor(view)) {
        return null;
    }

    const index = getMarkdownReferenceSource(view)
        ? indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST)
        : null;
    const selected = index && getSelectedBlocks(view, index);
    const paste = (
        access: ClipboardAccess, title: string, uiIcon: string, isExcerpt: boolean
    ): MenuItem<CommandNames> => ({
        title,
        uiIcon,
        enabled: access.enabled,
        handler: () => {
            void pasteClipboardReference(access, (reference) => {
                insertReference(view, reference, isExcerpt);
            });
        }
    });
    return {
        copy: selected && {
            title: t("block_reference.copy", { count: selected.count }),
            uiIcon: "bx bx-link",
            handler: () => void copyMarkdownReference(view, selected.start, selected.end)
        },
        copyTab: null,
        paste: clipboard
            ? [
                paste(clipboard, t("block_reference.paste_as_link"), "bx bx-link", false),
                paste(clipboard, t("block_reference.paste_as_excerpt"), "bx bx-window-alt", true)
            ]
            : []
    };
}

/**
 * Puts `reference` at the selection of `view`: as a Wikilink, or as an excerpt, a block of its own
 * after the block of the caret. In code, the excerpt goes at the caret as it is.
 */
function insertReference(view: CodeMirror, reference: ClipboardBlockReference, isExcerpt: boolean) {
    const { from, to } = view.state.selection.main;
    if (!isExcerpt) {
        replaceSelection(view, toWikilink(reference.href), from, to);
        return;
    }
    const excerpt = getExcerptHtml(reference);
    if (isInCode(view.state, from)) {
        replaceSelection(view, excerpt, from, to);
        return;
    }

    const line = view.state.doc.lineAt(from).number;
    const source = view.state.doc.toString();
    const change = insertHtmlBlock(source, line, excerpt, PREVIEW_BLOCK_HOST);
    if (!change) {
        toast.showError(t("block_reference.paste_failed"));
        return;
    }
    view.dispatch({ changes: change, userEvent: "input.paste" });
}
