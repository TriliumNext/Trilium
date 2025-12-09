import utils from "../services/utils.js";
import options from "../services/options.js";
import zoomService from "../components/zoom.js";
import contextMenu, { type MenuItem } from "./context_menu.js";
import { t } from "../services/i18n.js";
import type { BrowserWindow } from "electron";
import type { CommandNames, AppContext } from "../components/app_context.js";

function setupContextMenu() {
    const electron = utils.dynamicRequire("electron");

    const remote = utils.dynamicRequire("@electron/remote");
    // FIXME: Remove typecast once Electron is properly integrated.
    const { webContents } = remote.getCurrentWindow() as BrowserWindow;

    let appContext: AppContext;

    webContents.on("context-menu", (event, params) => {
        const { editFlags } = params;
        const hasText = params.selectionText.trim().length > 0;
        const isMac = process.platform === "darwin";
        const platformModifier = isMac ? "Meta" : "Ctrl";

        const items: MenuItem<CommandNames>[] = [];

        if (params.misspelledWord) {
            for (const suggestion of params.dictionarySuggestions) {
                items.push({
                    title: suggestion,
                    command: "replaceMisspelling",
                    spellingSuggestion: suggestion,
                    uiIcon: "bx bx-empty"
                });
            }

            items.push({
                title: t("electron_context_menu.add-term-to-dictionary", { term: params.misspelledWord }),
                uiIcon: "bx bx-plus",
                handler: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            });

            items.push({ kind: "separator" });
        }

        if (params.isEditable) {
            items.push({
                enabled: editFlags.canCut && hasText,
                title: t("electron_context_menu.cut"),
                shortcut: `${platformModifier}+X`,
                uiIcon: "bx bx-cut",
                handler: () => webContents.cut()
            });
        }

        if (params.isEditable || hasText) {
            items.push({
                enabled: editFlags.canCopy && hasText,
                title: t("electron_context_menu.copy"),
                shortcut: `${platformModifier}+C`,
                uiIcon: "bx bx-copy",
                handler: () => webContents.copy()
            });
        }

        if (!["", "javascript:", "about:blank#blocked"].includes(params.linkURL) && params.mediaType === "none") {
            items.push({
                title: t("electron_context_menu.copy-link"),
                uiIcon: "bx bx-copy",
                handler: () => {
                    electron.clipboard.write({
                        bookmark: params.linkText,
                        text: params.linkURL
                    });
                }
            });
        }

        if (params.isEditable) {
            items.push({
                enabled: editFlags.canPaste,
                title: t("electron_context_menu.paste"),
                shortcut: `${platformModifier}+V`,
                uiIcon: "bx bx-paste",
                handler: () => webContents.paste()
            });
        }

        if (params.isEditable) {
            items.push({
                enabled: editFlags.canPaste,
                title: t("electron_context_menu.paste-as-plain-text"),
                shortcut: `${platformModifier}+Shift+V`,
                uiIcon: "bx bx-paste",
                handler: () => webContents.pasteAndMatchStyle()
            });
        }

        if (hasText) {
            const shortenedSelection = params.selectionText.length > 15 ? `${params.selectionText.substr(0, 13)}…` : params.selectionText;

            // Read the search engine from the options and fallback to DuckDuckGo if the option is not set.
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

            // Replace the placeholder with the real search keyword.
            let searchUrl = searchEngineUrl.replace("{keyword}", encodeURIComponent(params.selectionText));

            items.push({ kind: "separator" });

            items.push({
                title: t("electron_context_menu.search_online", { term: shortenedSelection, searchEngine: searchEngineName }),
                uiIcon: "bx bx-search-alt",
                handler: () => electron.shell.openExternal(searchUrl)
            });

            items.push({
                title: t("electron_context_menu.search_in_trilium", { term: shortenedSelection }),
                uiIcon: "bx bx-search",
                handler: async () => {
                    if (!appContext) {
                        appContext = (await import("../components/app_context.js")).default;
                    }

                    await appContext.triggerCommand("searchNotes", {
                        searchString: params.selectionText
                    });
                }
            });
        }

        if (items.length === 0) {
            return;
        }

        const zoomLevel = zoomService.getCurrentZoom();

        contextMenu.show({
            x: params.x / zoomLevel,
            y: params.y / zoomLevel,
            items,
            selectMenuItemHandler: ({ command, spellingSuggestion }) => {
                if (command === "replaceMisspelling" && spellingSuggestion) {
                    webContents.insertText(spellingSuggestion);
                }
            }
        });
    });
}

export default {
    setupContextMenu
};
