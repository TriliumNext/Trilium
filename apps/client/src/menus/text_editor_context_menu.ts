import type {
    AiQuickAction, AiQuickActionFooter, AiQuickActionGroup, CKTextEditor, ModelElement,
    SlashCommandDefinition, SortTargetKind
} from "@triliumnext/ckeditor5";

import type { CommandNames } from "../components/app_context.js";
import { isExperimentalFeatureEnabled } from "../services/experimental_features.js";
import { t } from "../services/i18n.js";
import { escapeHtml } from "../services/utils.js";
import { getEditorNoteId } from "../widgets/react/NoteStore.js";
import type { ContextMenuOptions, MenuCommandItem, MenuItem } from "./context_menu.js";
import { submenuItem } from "./context_menu_utils.js";

/**
 * The _AI assistant_ row of the text editor's right-click menu, for the editor that holds the
 * selection. Returns `null` outside a text editor and wherever `buildAiAssistantMenuItem()` does.
 */
export async function buildAiActionsMenuItem(): Promise<MenuItem<CommandNames> | null> {
    return buildAiAssistantMenuItem(await getTextEditorAtSelection(), "bx bx-bot");
}

/**
 * The AI assistant entry of the formatting toolbar of `editor` as a menu row with the icon
 * `uiIcon`: a submenu with _Ask AI…_, then the quick actions and the footer rows of
 * `AiAssistantUI`, grouped and separated as in the toolbar's dropdown. Without quick actions, it is
 * a row that opens the assistant. The enabled state of the rows is read once, when the menu opens.
 *
 * With `blocks`, _Ask AI…_ and the quick actions select the blocks before they run, and the quick
 * actions that need content are enabled when the blocks have some.
 *
 * Returns `null` without `editor`, while no LLM provider is configured, and while a run streams.
 */
export function buildAiAssistantMenuItem(
    editor: CKTextEditor | null | undefined,
    uiIcon: string,
    blocks: readonly ModelElement[] = []
): MenuItem<CommandNames> | null {
    if (!editor?.plugins.has("AiAssistantUI")) {
        return null;
    }

    const ui = editor.plugins.get("AiAssistantUI");
    const command = editor.commands.get("aiAssistant");
    if (!command?.isEnabled || ui.isStreaming) {
        return null;
    }

    const target = getBlocksTarget(editor, blocks);
    const ask = () => {
        target?.select();
        editor.execute("aiAssistant");
    };
    // The plugin's list rather than the config's: the config only seeded it, and the content
    // languages behind Translate can be changed from inside the editor.
    const quickActions = buildQuickActionItems(
        ui.quickActions,
        target?.hasContent ?? ui.hasContext,
        (action) => {
            target?.select();
            ui.runQuickAction(action);
        }
    );

    // With nothing to hang off it the toolbar entry degrades from a split button to a plain one,
    // and so does this: a submenu holding a single row is a worse way to click that same row.
    if (!quickActions.length) {
        return { title: t("ai_assistant.title"), uiIcon, handler: ask };
    }

    return {
        title: t("ai_assistant.title"),
        uiIcon,
        items: [
            {
                title: t("ai_assistant.action_ask"),
                uiIcon: "bx bx-message-square-dots",
                handler: ask
            },
            { kind: "separator" },
            ...quickActions,
            ...(ui.menuFooter.length ? [{ kind: "separator" } as const, ...footerItems(ui.menuFooter)] : [])
        ]
    };
}

/**
 * The range from the first to the last of `blocks` in `editor`, as the target of the AI assistant
 * rows, or `null` without blocks. `select()` selects the range.
 */
function getBlocksTarget(editor: CKTextEditor, blocks: readonly ModelElement[]) {
    const first = blocks.at(0);
    const last = blocks.at(-1);
    if (!first || !last) {
        return null;
    }

    const model = editor.model;
    const range = model.createRange(
        model.createPositionBefore(first),
        model.createPositionAfter(last)
    );
    const { version } = model.document;
    return {
        hasContent: model.hasContent(range),
        select() {
            // A change while the menu is up leaves `range` pointing at other content, so the run
            // takes the selection as it is.
            if (model.document.version === version) {
                model.change((writer) => writer.setSelection(range));
            }
        }
    };
}

/**
 * A footer row, or the submenu it opens onto when it has children rather than something to run.
 * A child with a `heading` gets a header above it, as in the toolbar's dropdown.
 */
function footerItems(rows: ReadonlyArray<AiQuickActionFooter>): MenuItem<CommandNames>[] {
    return rows.map((row) => ({
        title: row.label,
        uiIcon: row.iconClass,
        enabled: true,
        ...(row.children
            ? {
                items: row.children.flatMap((child): MenuItem<CommandNames>[] => [
                    ...(child.heading ? [ { kind: "header", title: child.heading } as const ] : []),
                    ...footerItems([ child ])
                ])
            }
            : { handler: row.run })
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
 * The _Sort_ submenu for a selection over several blocks of `editor`, named by what it sorts. It
 * is `null` while the experimental feature is off, for a selection inside one block, and when
 * nothing at the selection can be sorted. `isRowsExcluded` leaves out a sort of table rows, for a
 * menu that has its own.
 */
export function buildSortSelectionMenuItem(
    editor: CKTextEditor | null | undefined,
    { isRowsExcluded = false } = {}
): MenuItem<CommandNames> | null {
    const command = editor?.commands.get("triliumSortSelectionAscending");
    if (!editor || !command?.isEnabled || !command.value
            || (isRowsExcluded && command.value === "rows")
            || !isExperimentalFeatureEnabled("sortSelection")
            || Array.from(editor.model.document.selection.getSelectedBlocks()).length < 2) {
        return null;
    }

    const sortItem = (title: string, uiIcon: string, commandName: SortSelectionCommandName) => ({
        title,
        uiIcon,
        handler: () => {
            editor.execute(commandName);
            editor.editing.view.focus();
        }
    });
    return submenuItem({ title: getSortMenuTitle(command.value), uiIcon: "bx bx-sort-alt-2" }, [
        sortItem(t("sort_selection.ascending"), "bx bx-sort-up", "triliumSortSelectionAscending"),
        sortItem(t("sort_selection.descending"), "bx bx-sort-down",
            "triliumSortSelectionDescending")
    ]);
}

/**
 * The `/` palette's `definitions` that insert or wrap content as menu rows, drawn as the
 * `/` palette draws them, which run the one picked with `run`.
 */
export function buildInsertMenuItems<T>(
    definitions: SlashCommandDefinition[], run: (definition: SlashCommandDefinition) => void
): MenuCommandItem<T>[] {
    return definitions
        .filter((definition) => definition.willInsert || definition.willWrap)
        .map((definition) => ({
            title: escapeHtml(definition.title),
            description: definition.description,
            keywords: definition.aliases,
            uiIcon: definition.iconClass ?? "bx bx-empty",
            uiIconSvg: definition.iconClass ? undefined : definition.icon,
            iconColorClass: definition.iconColorClass,
            handler: () => run(definition)
        }));
}

/**
 * The text editor the live DOM selection sits in, or `null` when it sits anywhere else.
 *
 * The containment check is what makes this answer the click rather than the tab: the active note
 * can be a text note while the selection is in a dialog or a plain input, and the editor would
 * happily report its own stale model selection for it.
 *
 * Returns `null` as well for a selection in the content of an embed, such as the CodeMirror of an
 * extended code block, where the model selection of the editor around it is the whole embed.
 */
export async function getTextEditorAtSelection(): Promise<CKTextEditor | null> {
    const anchor = window.getSelection()?.anchorNode;
    return isInEmbedContent(anchor) ? null : getTextEditorContaining(anchor);
}

/**
 * Returns the text editor of a note whose editable contains `node`, or `null` when no such editor
 * does. Takes the right-click target instead of the DOM selection, because a right-click does not
 * move the selection in every browser.
 *
 * Reads the editor off the innermost editable root around `node`, so it finds the editor of a split
 * pane the right-click did not activate, of a dialog such as the quick edit, and of an included
 * note edited in place. An editor that holds no note, such as the attribute editor, does not count.
 */
export async function getTextEditorContaining(
    node: Node | null | undefined
): Promise<CKTextEditor | null> {
    const element = node instanceof Element ? node : node?.parentElement;
    const editor = element?.closest<EditorRootElement>(EDITOR_ROOT_SELECTOR)?.ckeditorInstance;
    return editor && getEditorNoteId(editor) ? editor : null;
}

/**
 * Menu options adding the menu to the focus tracker of `editor`, so that the editor stays focused
 * while the menu is up.
 */
export function keepEditorFocused(
    editor: { ui: Pick<CKTextEditor["ui"], "focusTracker"> }
): Pick<ContextMenuOptions<CommandNames>, "onShow" | "onHide"> {
    let menuContainer: HTMLElement | null = null;

    return {
        onShow: (container) => {
            menuContainer = container;
            editor.ui.focusTracker.add(container);
        },
        onHide: () => {
            if (menuContainer) {
                editor.ui.focusTracker.remove(menuContainer);
            }
        }
    };
}

type SortSelectionCommandName = "triliumSortSelectionAscending" | "triliumSortSelectionDescending";

function getSortMenuTitle(kind: SortTargetKind) {
    switch (kind) {
        case "listItems":
            return t("sort_selection.sort_list_items");
        case "rows":
            return t("sort_selection.sort_rows");
        case "blocks":
            return t("sort_selection.sort_blocks");
    }
}

/**
 * Whether `node` is in the content of an embed of the innermost text editor around it. The wrapper
 * of an embed has `data-cke-ignore-events`, as in `nested_editor_events.ts`.
 */
function isInEmbedContent(node: Node | null | undefined) {
    const element = node instanceof Element ? node : node?.parentElement;
    const wrapper = element?.closest("[data-cke-ignore-events]");
    return !!wrapper && !!element?.closest(EDITOR_ROOT_SELECTOR)?.contains(wrapper);
}

/** The editable root of a text editor, which CKEditor gives a reference to the editor. */
type EditorRootElement = HTMLElement & { ckeditorInstance?: CKTextEditor | null };

const EDITOR_ROOT_SELECTOR = ".ck-editor__editable:not(.ck-editor__nested-editable)";
