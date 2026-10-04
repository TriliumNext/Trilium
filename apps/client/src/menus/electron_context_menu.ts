import type { ElectronApi, ElectronContextMenuParams } from "@triliumnext/commons";

import zoomService from "../components/zoom.js";
import contextMenu from "./context_menu.js";
import { buildNoteContextMenuItems, type ContextMenuHost } from "./note_context_menu.js";

/**
 * Replaces the browser's menu with Trilium's throughout the Electron window.
 *
 * Unlike the browser build, this claims every right-click: Chromium hands the embedding
 * application its spell-check state and its clipboard, so nothing is lost by taking the menu over.
 */
function setupContextMenu() {
    const eApi = window.electronApi;
    if (!eApi) return;
    const api = eApi.contextMenu;

    api.onContextMenu(async (params) => {
        // The IPC params contain only window coordinates, so `document.elementFromPoint()` finds
        // the element under the pointer. Dividing by the zoom factor converts them to CSS pixels.
        const zoomLevel = zoomService.getCurrentZoom();

        const items = await buildNoteContextMenuItems({
            linkURL: params.linkURL,
            linkText: params.linkText,
            isMedia: params.mediaType !== "none",
            isEditable: params.isEditable,
            selectionText: params.selectionText,
            element: document.elementFromPoint(params.x / zoomLevel, params.y / zoomLevel)
        }, electronHost(eApi, params));

        if (items.length === 0) {
            return;
        }

        contextMenu.show({
            x: params.x / zoomLevel,
            y: params.y / zoomLevel,
            items,
            selectMenuItemHandler: ({ command, spellingSuggestion }) => {
                if (command === "replaceMisspelling" && spellingSuggestion) {
                    api.webContentsAction("insertText", spellingSuggestion);
                }
            }
        });
    });
}

/** The host for Electron, where Chromium answers for the clipboard and the spell checker. */
function electronHost(eApi: ElectronApi, params: ElectronContextMenuParams): ContextMenuHost {
    const api = eApi.contextMenu;
    const { editFlags } = params;

    return {
        spelling: {
            misspelledWord: params.misspelledWord,
            suggestions: params.dictionarySuggestions,
            addToDictionary: (word) => eApi.spellcheck.addWordToDictionary(word)
        },
        paste: {
            enabled: editFlags.canPaste,
            run: () => api.webContentsAction("paste"),
            runAsPlainText: () => api.webContentsAction("pasteAndMatchStyle"),
            read: async () => {
                const [html, text] = await Promise.all([
                    eApi.clipboard.readHTML(),
                    eApi.clipboard.readText()
                ]);
                return { html, text };
            }
        },
        canCut: editFlags.canCut,
        cut: () => api.webContentsAction("cut"),
        canCopy: editFlags.canCopy,
        copy: () => api.webContentsAction("copy"),
        openExternal: (url) => eApi.shell.openExternal(url)
    };
}

export default {
    setupContextMenu
};
