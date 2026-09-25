import type { CKTextEditor } from "@triliumnext/ckeditor5";

import appContext, { type CommandNames } from "../components/app_context.js";
import { copyHtml, copyTextWithToast } from "../services/clipboard_ext.js";
import { t } from "../services/i18n.js";
import options from "../services/options.js";
import server from "../services/server.js";
import utils from "../services/utils.js";
import contextMenu, { type MenuItem } from "./context_menu.js";
import { buildAiActionsMenuItem, getTextEditorAtSelection } from "./text_editor_context_menu.js";

/** What the pointer was over when the menu was summoned. */
export interface ContextMenuTarget {
    /** URL of the link under the pointer, or an empty string. */
    linkURL: string;
    /** Visible text of that link, or an empty string. */
    linkText: string;
    /** Whether the pointer is over an image, video or audio element. */
    isMedia: boolean;
    /** Whether the element under the pointer accepts typing. */
    isEditable: boolean;
    /** The selected text, or an empty string. */
    selectionText: string;
}

/**
 * What the surrounding application can run on the menu's behalf. An optional member the host leaves
 * out drops the rows that depend on it: a page reaches neither the spell checker's state nor a
 * paste cheaper than Ctrl+V, so a browser host supplies neither.
 */
export interface ContextMenuHost {
    spelling?: {
        misspelledWord: string;
        suggestions: string[];
        addToDictionary(word: string): void;
    };
    paste?: {
        enabled: boolean;
        run(): void;
        runAsPlainText(): void;
    };
    canCut: boolean;
    cut(): void | Promise<void>;
    canCopy: boolean;
    copy(): void | Promise<void>;
    /** Opens a URL outside the note, in whatever the host uses for external links. */
    openExternal(url: string): void;
}

/**
 * Puts Trilium's menu over the browser's own wherever the pointer sits on a selection. A click at a
 * bare caret keeps the native menu, the only way to spelling corrections and the browser's paste.
 * Electron replaces the menu everywhere; see `electron_context_menu.ts`.
 */
export function setupContextMenu() {
    document.addEventListener("contextmenu", (event) => {
        // A widget that answers the click itself — the note tree, an internal link — has already
        // put its own menu up.
        if (event.defaultPrevented) {
            return;
        }

        // Shift+right-click is Firefox's own way back to the browser's menu; honoring it gives
        // Chrome and Safari, which have no bypass of their own, the same one.
        if (event.shiftKey) {
            return;
        }

        // `window.getSelection()` does not report a selection inside an `<input>` or `<textarea>`,
        // so those keep the browser's menu, which is the better one for a plain text field.
        const selection = window.getSelection();
        const selectionText = selection?.toString() ?? "";
        if (!selection || !selectionText.trim()) {
            return;
        }

        // The rows act on the selection, so the pointer has to be on it. A right-click on the
        // surrounding UI, which takes no selection of its own, leaves an earlier one standing.
        if (!isPointInSelection(selection, event.clientX, event.clientY)) {
            return;
        }

        // Claimed before the items are built: after an await the default action has already run.
        event.preventDefault();

        const element = event.target instanceof HTMLElement ? event.target : null;
        const link = element?.closest("a[href]");

        void showBrowserContextMenu(event.pageX, event.pageY, {
            linkURL: link instanceof HTMLAnchorElement ? link.href : "",
            linkText: link?.textContent ?? "",
            isMedia: !!element?.closest("img, video, audio"),
            isEditable: acceptsTyping(element),
            selectionText
        });
    });
}

/**
 * The rows the menu shows for `target`, in order, leaving out whatever `host` cannot serve.
 *
 * Callers own the positioning and the `selectMenuItemHandler`, because the spelling suggestions
 * carry a `replaceMisspelling` command rather than a handler — only the host that produced them
 * can commit one.
 */
export async function buildNoteContextMenuItems(
    target: ContextMenuTarget,
    host: ContextMenuHost
): Promise<MenuItem<CommandNames>[]> {
    const hasText = target.selectionText.trim().length > 0;
    const platformModifier = utils.isMac() ? "Meta" : "Ctrl";
    const items: MenuItem<CommandNames>[] = [];

    // Resolved before the menu is built rather than lazily in a handler: the rows it produces
    // depend on how the editor answers, and `isEditable` keeps the lookup off every click that
    // lands somewhere a completion could not be committed anyway (a read-only note, the tree).
    const aiActions = target.isEditable ? await buildAiActionsMenuItem() : null;

    if (host.spelling?.misspelledWord) {
        const { misspelledWord, suggestions, addToDictionary } = host.spelling;

        for (const suggestion of suggestions) {
            items.push({
                title: suggestion,
                command: "replaceMisspelling",
                spellingSuggestion: suggestion,
                uiIcon: "bx bx-empty"
            });
        }

        items.push({
            title: t("electron_context_menu.add-term-to-dictionary", { term: misspelledWord }),
            uiIcon: "bx bx-plus",
            handler: () => addToDictionary(misspelledWord)
        });

        items.push({ kind: "separator" });
    }

    if (aiActions) {
        items.push(aiActions, { kind: "separator" });
    }

    if (target.isEditable) {
        items.push({
            enabled: host.canCut && hasText,
            title: t("electron_context_menu.cut"),
            shortcut: `${platformModifier}+X`,
            uiIcon: "bx bx-cut",
            handler: () => host.cut()
        });
    }

    if (target.isEditable || hasText) {
        items.push({
            enabled: host.canCopy && hasText,
            title: t("electron_context_menu.copy"),
            shortcut: `${platformModifier}+C`,
            uiIcon: "bx bx-copy",
            handler: () => host.copy()
        });

        items.push({
            enabled: hasText,
            title: t("electron_context_menu.copy-as-markdown"),
            uiIcon: "bx bx-copy-alt",
            handler: copySelectionAsMarkdown
        });
    }

    const unlinkable = [ "", "javascript:", "about:blank#blocked" ];
    if (!unlinkable.includes(target.linkURL) && !target.isMedia) {
        items.push({
            title: t("electron_context_menu.copy-link"),
            uiIcon: "bx bx-copy",
            handler: () => {
                const text = utils.escapeHtml(target.linkText || target.linkURL);
                const html = `<a href="${utils.escapeHtml(target.linkURL)}">${text}</a>`;
                void copyHtml(html, target.linkURL);
            }
        });
    }

    if (host.paste && target.isEditable) {
        const { enabled, run, runAsPlainText } = host.paste;

        items.push({
            enabled,
            title: t("electron_context_menu.paste"),
            shortcut: `${platformModifier}+V`,
            uiIcon: "bx bx-paste",
            handler: run
        });

        items.push({
            enabled,
            title: t("electron_context_menu.paste-as-plain-text"),
            shortcut: `${platformModifier}+Shift+V`,
            uiIcon: "bx bx-paste",
            handler: runAsPlainText
        });
    }

    if (hasText) {
        const { selectionText } = target;
        const shortenedSelection = selectionText.length > 15
            ? `${selectionText.slice(0, 13)}…`
            : selectionText;

        const customSearchEngineName = options.get("customSearchEngineName");
        const customSearchEngineUrl = options.get("customSearchEngineUrl") as string;
        let searchEngineName;
        let searchEngineUrl;
        if (customSearchEngineName && customSearchEngineUrl) {
            searchEngineName = customSearchEngineName;
            searchEngineUrl = customSearchEngineUrl;
        } else {
            searchEngineName = "DuckDuckGo";
            searchEngineUrl = "https://duckduckgo.com/?q={keyword}";
        }

        const searchUrl = searchEngineUrl.replace("{keyword}", encodeURIComponent(selectionText));

        items.push({ kind: "separator" });

        items.push({
            title: t("electron_context_menu.search_online", {
                term: shortenedSelection,
                searchEngine: searchEngineName
            }),
            uiIcon: "bx bx-search-alt",
            handler: () => host.openExternal(searchUrl)
        });

        items.push({
            title: t("electron_context_menu.search_in_trilium", { term: shortenedSelection }),
            uiIcon: "bx bx-search",
            handler: async () => {
                await appContext.triggerCommand("searchNotes", { searchString: selectionText });
            }
        });
    }

    return items;
}

/**
 * Returns the HTML to feed to the Markdown converter for the "Copy as Markdown" action.
 *
 * When the selection lives inside the active text note's CKEditor, we take the editor's
 * data-pipeline HTML (`getSelectedHtml()`) — clean stored markup without the editing-view
 * artifacts (`data-list-item-id`, collapsible handle/arrow spans, bogus-paragraph wrappers)
 * that cloning the live DOM range drags along. For any other selection (read-only notes,
 * dialogs, plain inputs) we fall back to cloning the DOM range.
 */
export async function getSelectedHtmlForMarkdown(): Promise<string> {
    const editor = await getTextEditorAtSelection();
    const selectedHtml = editor?.getSelectedHtml();
    if (selectedHtml) return selectedHtml;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return "";

    const range = selection.getRangeAt(0);
    const div = document.createElement("div");
    div.appendChild(range.cloneContents());
    return div.innerHTML;
}

async function showBrowserContextMenu(x: number, y: number, target: ContextMenuTarget) {
    const editor = await getTextEditorAtSelection();
    const items = await buildNoteContextMenuItems(target, browserHost(editor));
    if (!items.length) return;

    contextMenu.show({ x, y, items, selectMenuItemHandler: () => {} });
}

/** Whether the point (`x`, `y`), in viewport coordinates, lands on what `selection` highlights. */
function isPointInSelection(selection: Selection, x: number, y: number) {
    for (let i = 0; i < selection.rangeCount; i++) {
        for (const rect of Array.from(selection.getRangeAt(i).getClientRects())) {
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Whether `element` takes typing, which is what decides the rows that write to a note.
 *
 * `isContentEditable` alone does not answer it inside a code note. CodeMirror drives
 * `contenteditable` off its `editable` facet, which Trilium never lowers, and marks a read-only
 * note with `aria-readonly` on the same element instead — so the attribute is what tells the two
 * apart.
 */
function acceptsTyping(element: HTMLElement | null) {
    return !!element?.isContentEditable && !element.closest("[aria-readonly='true']");
}

/**
 * The host for a page, which has web APIs and nothing more.
 *
 * `editor` is what the selection sits in, when it sits in a text note at all — `null` in a code
 * note, which has a CodeMirror instead, and in a plain field.
 */
function browserHost(editor: CKTextEditor | null): ContextMenuHost {
    return {
        canCut: !editor?.isReadOnly,
        cut() {
            // A text note's editor is asked directly, so that the clipboard gets the clean
            // data-pipeline HTML `copySelection` reads rather than the editing view's markup.
            // Everywhere else the browser cuts, and CodeMirror takes that as it would any edit.
            if (!editor) {
                document.execCommand("cut");
                return;
            }

            return copySelection().then(() => editor.execute("delete"));
        },
        canCopy: true,
        copy: copySelection,
        openExternal: (url) => window.open(url, "_blank", "noopener")
    };
}

/** Copies the selection as rich text, so that it pastes back into a note with its formatting. */
async function copySelection() {
    const html = await getSelectedHtmlForMarkdown();
    const plainText = window.getSelection()?.toString() ?? "";
    if (!html && !plainText) return;

    await copyHtml(html || utils.escapeHtml(plainText), plainText);
}

async function copySelectionAsMarkdown() {
    const htmlContent = await getSelectedHtmlForMarkdown();
    if (!htmlContent) return;

    try {
        const { markdownContent } = await server.post<{ markdownContent: string }>(
            "other/to-markdown",
            { htmlContent }
        );
        copyTextWithToast(markdownContent);
    } catch (error) {
        console.error("Failed to copy as markdown:", error);
    }
}
