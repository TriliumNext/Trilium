import type { AiQuickAction, AiQuickActionFooter, AiQuickActionGroup, CKTextEditor } from "@triliumnext/ckeditor5";

import type { CommandNames } from "../components/app_context.js";
import appContext from "../components/app_context.js";
import { t } from "../services/i18n.js";
import type { MenuItem } from "./context_menu.js";

/**
 * The "AI assistant" row of the text editor's right-click menu: the toolbar's split-button entry,
 * reproduced as a submenu — its main action first, then the same quick actions in the same groups,
 * separated the same way.
 *
 * Right-click is where Word, Pages and the Obsidian AI plugins all put this, and it is the one
 * place the feature can be reached without knowing that a toolbar button or a `/` command exists.
 * The menu is built per click and read from the same `config.aiAssistant.quickActions` the toolbar
 * renders, so the two cannot drift; unlike the toolbar's, its enablement is a snapshot rather than
 * an observable binding, which is all a menu that lives for one click needs.
 *
 * Returns `null` whenever the assistant is out of reach — the click was not inside a text editor,
 * no LLM provider is configured, or a run is already streaming into the one dialog it has.
 */
export async function buildAiActionsMenuItem(): Promise<MenuItem<CommandNames> | null> {
    const editor = await getTextEditorAtSelection();
    if (!editor?.plugins.has("AiAssistantUI")) {
        return null;
    }

    const ui = editor.plugins.get("AiAssistantUI");
    const command = editor.commands.get("aiAssistant");
    if (!command?.isEnabled || ui.isStreaming) {
        return null;
    }

    // The plugin's list rather than the config's: the config only seeded it, and the content
    // languages behind Translate can be changed from inside the editor.
    const quickActions = buildQuickActionItems(
        ui.quickActions,
        ui.hasContext,
        (action) => ui.runQuickAction(action)
    );

    // With nothing to hang off it the toolbar entry degrades from a split button to a plain one,
    // and so does this: a submenu holding a single row is a worse way to click that same row.
    if (!quickActions.length) {
        return {
            title: t("ai_assistant.title"),
            uiIcon: "bx bx-bot",
            handler: () => editor.execute("aiAssistant")
        };
    }

    return {
        title: t("ai_assistant.title"),
        uiIcon: "bx bx-bot",
        items: [
            {
                title: t("ai_assistant.action_ask"),
                uiIcon: "bx bx-message-square-dots",
                handler: () => editor.execute("aiAssistant")
            },
            { kind: "separator" },
            ...quickActions,
            ...(ui.menuFooter.length ? [{ kind: "separator" } as const, ...footerItems(ui.menuFooter)] : [])
        ]
    };
}

/** A footer row, or the submenu it opens onto when it has children rather than something to run. */
function footerItems(rows: ReadonlyArray<AiQuickActionFooter>): MenuItem<CommandNames>[] {
    return rows.map((row) => ({
        title: row.label,
        uiIcon: row.iconClass,
        enabled: true,
        ...(row.children ? { items: footerItems(row.children) } : { handler: row.run })
    }));
}

/**
 * The quick actions as menu rows, laid out the way the toolbar's dropdown lays them out: a group
 * marked `submenu` opens one, an inlined group contributes its actions directly, and a rule is
 * drawn between groups except between two consecutive submenus, which read as one block of openers
 * already.
 *
 * @param hasContext whether there is content to work on, as the assistant reports it. Actions that
 *                   need content — every one Trilium ships — are disabled without it, and so is a
 *                   submenu whose actions all do.
 */
function buildQuickActionItems(
    groups: ReadonlyArray<AiQuickActionGroup>,
    hasContext: boolean,
    run: (action: AiQuickAction) => void
): MenuItem<CommandNames>[] {
    const canRun = (action: AiQuickAction) => action.requiresContent === false || hasContext;
    const items: MenuItem<CommandNames>[] = [];

    for (const [index, group] of groups.entries()) {
        const children: MenuItem<CommandNames>[] = group.actions.map((action) => ({
            title: action.label,
            uiIcon: action.iconClass,
            enabled: canRun(action),
            handler: () => run(action)
        }));

        if (group.submenu) {
            if (group.footer) {
                children.push({ kind: "separator" }, {
                    title: group.footer.label,
                    uiIcon: group.footer.iconClass,
                    // Configures the group rather than running against the document, so it stays
                    // reachable when everything above it is closed off — as does its submenu.
                    enabled: true,
                    handler: group.footer.run
                });
            }
            items.push({
                title: group.label,
                uiIcon: group.iconClass,
                enabled: !!group.footer || group.actions.some(canRun),
                items: children
            });
        } else {
            items.push(...children);
        }

        const next = groups[index + 1];
        if (next && !(group.submenu && next.submenu)) {
            items.push({ kind: "separator" });
        }
    }

    return items;
}

/**
 * The text editor the live DOM selection sits in, or `null` when it sits anywhere else.
 *
 * The containment check is what makes this answer the click rather than the tab: the active note
 * can be a text note while the selection is in a dialog or a plain input, and the editor would
 * happily report its own stale model selection for it.
 */
export async function getTextEditorAtSelection(): Promise<CKTextEditor | null> {
    if (appContext.tabManager.getActiveContextNote()?.type !== "text") {
        return null;
    }

    try {
        const editor = await appContext.tabManager.getActiveContext()?.getTextEditor();
        const domRoot = editor?.editing.view.getDomRoot();
        const anchorNode = window.getSelection()?.anchorNode;

        if (editor && domRoot && anchorNode && domRoot.contains(anchorNode)) {
            return editor;
        }
    } catch (error) {
        // Editor not ready or the request timed out.
        console.error("Failed to read the text editor at the selection:", error);
    }

    return null;
}
