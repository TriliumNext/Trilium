import {
    addMenuToDropdown,
    ButtonView,
    CKEditorError,
    createDropdown,
    Dialog,
    DialogViewPosition,
    ListSeparatorView,
    Plugin,
    SplitButtonView,
    View,
    type DropdownMenuDefinition,
    type DropdownMenuListItemButtonView,
    type DropdownView,
    type Locale,
    type ModelNode,
    type ModelRange
} from "ckeditor5";

import { extractDelimiters, renderEquation } from "../math/utils.js";
import type { AiCompletionUsage, AiConversationTurn, AiDiffResult, AiQuickAction, AiQuickActionFooter, AiQuickActionGroup, AiReviewView, AiSurroundings } from "./ai_assistant_config.js";
import AiAssistantEditing, { AI_TARGET_MARKER } from "./ai_assistant_editing.js";
import AiAssistantFormView from "./ai_assistant_form.js";
import aiIcon from "./theme/icons/ai.svg?raw";
import "./theme/ai_assistant.css";

/**
 * SSE chunks can arrive per-token; re-rendering the whole preview for each one buys nothing
 * visually and burns CPU re-parsing the growing prefix. One render per interval is smooth enough.
 */
const RENDER_THROTTLE_MS = 80;

/** Identifies our dialog in the editor-wide `Dialog` plugin, which shows one dialog at a time. */
const DIALOG_ID = "aiAssistant";

/**
 * Identifies the menu row that opens the assistant for a typed prompt. Prefixed out of the way of
 * the host's action ids, which share the same id space.
 */
const ASK_ID = "__ask";

/** Prefixes the ids of the rows closing the menu, out of the way of the host's own. */
const MENU_FOOTER_ID = "__footer";

/**
 * How much of a response has to be a replacement rather than an edit (see
 * `AiDiffResult.rewriteRatio`) before the review opens on the plain result instead of the diff.
 * Half is the point where the "Changes" view stops being a set of marks on a text one can still
 * read and becomes two texts stacked on each other.
 */
const REWRITE_RATIO_THRESHOLD = 0.5;

/**
 * How much of the note either side of the target is sent as surroundings. Enough for the section
 * the target sits in, which is what places it; a note long enough to overrun this is one whose
 * distant paragraphs say nothing about the sentence being rewritten, and the assistant is not a
 * retrieval engine — it should not quietly turn every run into a whole-note upload.
 */
const SURROUNDINGS_LIMIT = 1500;

/** What a run with nothing around it sends, and what the plugin holds while it is closed. */
const EMPTY_SURROUNDINGS: AiSurroundings = { before: "", after: "" };

/**
 * Opens the assistant from the keyboard, which is how the feature is reached without leaving the
 * text being written.
 *
 * Neither of the idioms it would like is free: Ctrl+K creates a link, here as in every other
 * editor, and Ctrl+J is Trilium's Jump to note. This keeps the K that Cursor, Linear and Slack
 * made the key for "ask for something" without taking either — and CKEditor maps `Ctrl` to `Cmd`
 * on macOS, so it reads as ⌘⇧K there.
 */
const AI_ASSISTANT_KEYSTROKE = "Ctrl+Shift+K";

/**
 * The AI assistant's UI and orchestration: the toolbar entry (a split button whose menu holds the
 * host's quick actions), the dialog form, and the stream-preview-commit lifecycle.
 *
 * The core design decision is that **the stream never touches the document**. The response
 * streams into the form's detached preview; the note is modified exactly once, when the user
 * commits with Replace or Insert below — a single `model.change()`, so a single undo step.
 *
 * The form lives in a **non-modal dialog** rather than a balloon. A balloon anchors to the target
 * text, which means it has to be repositioned on every streamed chunk and still ends up covering
 * the very content being rewritten on a large selection; it also shares one stack with the balloon
 * toolbar that `PopupEditor` (floating-toolbar mode) shows on exactly the selections the assistant
 * opens on. The dialog is anchored to the editor instead, is draggable, and leaves the document
 * visible and editable — so the target highlight stays on screen while the response is reviewed.
 */
export default class AiAssistantUI extends Plugin {

    static get requires() {
        return [AiAssistantEditing, Dialog] as const;
    }

    static get pluginName() {
        return "AiAssistantUI" as const;
    }

    /**
     * Whether a run is in flight. Observable, because the toolbar entry closes itself off while
     * the assistant is busy — a second run would stream into the same preview.
     */
    declare public isStreaming: boolean;
    /**
     * Whether there is content for a quick action to work on: a non-collapsed selection, or, once
     * the assistant is open, whatever it captured — after a run, the response being chained on.
     * Gates the `requiresContent` actions in the toolbar menu.
     */
    declare public hasContext: boolean;

    private _formView: AiAssistantFormView | null = null;
    private _abortController: AbortController | null = null;

    /** The cumulative response HTML of the current/last run, as the host delivered it. */
    private _cumulative = "";
    /**
     * The same response in the form the host rendered it from, which is what the conversation
     * records — a host reporting no source records the HTML instead.
     */
    private _cumulativeSource = "";
    /** The HTML the conversation opened on, sent with every request it makes. */
    private _openingContext = "";
    /** What surrounds it in the note, captured with it and sent alongside it. */
    private _surroundings: AiSurroundings = EMPTY_SURROUNDINGS;
    /**
     * The HTML each response is measured against: the selection, then each response chained on.
     * What a run *asks* about is {@link _openingContext} plus {@link _history} — this is what the
     * diff runs against and what tells the quick actions there is something to work on.
     */
    private _context = "";
    /** The context of the last run, restored by "Try again" so a retry does not chain on itself. */
    private _previousContext = "";
    /** The exchanges so far, which the next request carries — see `AiCompletionRequest.history`. */
    private _history: AiConversationTurn[] = [];
    /** The history of the last run, restored by "Try again" alongside {@link _previousContext}. */
    private _previousHistory: AiConversationTurn[] = [];
    private _lastQuery = "";
    /**
     * The view the running quick action asked its review to open on, when it named one. Null for a
     * typed prompt, which leaves the choice to the diff.
     */
    private _reviewView: AiReviewView | null = null;

    /**
     * The quick actions as they stand, which the config only seeds — see {@link updateQuickActions}.
     * Every surface offering them reads this rather than the config, so they cannot disagree about
     * what is on offer.
     */
    private _quickActions: AiQuickActionGroup[] = [];
    /** The rows closing the menu, which the config likewise only seeds. */
    private _menuFooter: AiQuickActionFooter[] = [];
    /**
     * Marks each menu built from {@link _quickActions} as owing a redraw, one closure per toolbar
     * showing us.
     */
    private readonly _invalidateMenu: Array<() => void> = [];

    public get quickActions(): ReadonlyArray<AiQuickActionGroup> {
        return this._quickActions;
    }

    public get menuFooter(): ReadonlyArray<AiQuickActionFooter> {
        return this._menuFooter;
    }

    public init(): void {
        const editor = this.editor;

        this.set("isStreaming", false);
        this.set("hasContext", false);
        this._quickActions = editor.config.get("aiAssistant")?.quickActions ?? [];
        this._menuFooter = editor.config.get("aiAssistant")?.menuFooter ?? [];

        editor.ui.componentFactory.add("aiAssistant", (locale) => this._createToolbarComponent(locale));

        editor.keystrokes.set(AI_ASSISTANT_KEYSTROKE, (_data, cancel) => {
            const command = editor.commands.get("aiAssistant");
            // Nothing to open without a provider configured, and the keystroke has to fall through
            // rather than be swallowed by a feature that cannot run.
            if (!command?.isEnabled) {
                return;
            }
            editor.execute("aiAssistant");
            cancel();
        });

        // While the assistant is closed the quick actions are offered against the selection, so
        // their enablement has to follow it.
        this.listenTo(editor.model.document.selection, "change:range", () => this._updateHasContext());
    }

    /**
     * The toolbar entry. Its main action opens the assistant on the selection; its menu lists the
     * host's quick actions, grouped as configured, and picking one opens the assistant and runs
     * that instruction straight away — the free-form prompt is one way in, not the only one.
     *
     * With no quick actions configured there is nothing to hang off an arrow, so the component
     * degrades to a plain button.
     */
    private _createToolbarComponent(locale: Locale): ButtonView | DropdownView {
        // Which of the two the entry is, is settled here and for good: a toolbar item cannot change
        // its own kind. A host that configures actions at all keeps configuring some.
        return this._quickActions.length
            ? this._createQuickActionsDropdown(locale)
            : this._createAssistantButton(locale);
    }

    /**
     * Replaces the quick actions on a live editor, redrawing every menu built from them — the same
     * contract `TriliumSnippets.updateDefinitions` has, and for the same reason: a list the user
     * edits from inside the editor cannot wait for the editor to be rebuilt to say what it now
     * holds, and rebuilding one costs the caret and the undo history.
     *
     * A menu is redrawn the next time it opens rather than on the spot. CKEditor builds its views
     * in `render()`, which `addMenuToDropdown` defers to the first open, so a menu that has never
     * been opened has nothing to redraw yet — and one that has is not on screen to see it happen.
     */
    public updateQuickActions(groups: AiQuickActionGroup[]): void {
        this._quickActions = groups;
        this._redrawMenus();
    }

    /**
     * Replaces the rows closing the menu. Same contract as {@link updateQuickActions} — and the same
     * necessity, since a row that names a setting has to restate it once the setting changes.
     */
    public updateMenuFooter(rows: AiQuickActionFooter[]): void {
        this._menuFooter = rows;
        this._redrawMenus();
        // The dialog offers the same setting beside its prompt, and outlives the menu: it stays
        // open across a follow-up and a retry, which is exactly when the model is worth changing.
        this._formView?.setPicker(this._pickerRow());
    }

    /**
     * The footer row the dialog offers as a picker: the one that opens onto choices. A row that
     * simply runs is a menu action, and the dialog has its own buttons for those.
     */
    private _pickerRow(): AiQuickActionFooter | null {
        return this._menuFooter.find((row) => row.children?.length) ?? null;
    }

    private _redrawMenus(): void {
        for (const invalidate of this._invalidateMenu) {
            invalidate();
        }
    }

    private _createAssistantButton(locale: Locale): ButtonView {
        const command = this.editor.commands.get("aiAssistant");
        const buttonView = new ButtonView(locale);

        buttonView.set({
            label: locale.t("AI assistant"),
            icon: aiIcon,
            keystroke: AI_ASSISTANT_KEYSTROKE,
            tooltip: true
        });
        /* v8 ignore next -- AiAssistantEditing always registers the command (it is required by this plugin) */
        if (command) {
            buttonView.bind("isEnabled").to(command, "isEnabled", this, "isStreaming", isAvailable);
        }
        this.listenTo(buttonView, "execute", () => this.editor.execute("aiAssistant"));

        return buttonView;
    }

    /**
     * The split button: the icon opens the assistant, the arrow opens the quick actions. Actions
     * marked `requiresContent` stay disabled until there is something to work on — a selection, or
     * a response to chain on.
     */
    private _createQuickActionsDropdown(locale: Locale): DropdownView {
        const command = this.editor.commands.get("aiAssistant");
        const dropdownView = createDropdown(locale, SplitButtonView);
        const splitButtonView = dropdownView.buttonView;

        splitButtonView.set({
            label: locale.t("AI assistant"),
            icon: aiIcon,
            // On the action half, which is the half the keystroke stands for: the arrow opens the
            // quick actions, and Ctrl+Shift+K opens the prompt.
            keystroke: AI_ASSISTANT_KEYSTROKE,
            tooltip: true
        });
        // A dropdown passes `isEnabled` down to its button, so this covers both halves of the
        // split button.
        /* v8 ignore next -- AiAssistantEditing always registers the command (it is required by this plugin) */
        if (command) {
            dropdownView.bind("isEnabled").to(command, "isEnabled", this, "isStreaming", isAvailable);
        }
        this.listenTo(splitButtonView, "execute", () => this.editor.execute("aiAssistant"));

        // The menu carries only ids and labels, so the action each button stands for is looked up
        // on execute rather than carried by the view. Refilled by every draw: which actions there
        // are is the very thing a redraw changes.
        const actionsById = new Map<string, AiQuickAction>();
        const footersById = new Map<string, AiQuickActionFooter>();
        const groupsById = new Map<string, AiQuickActionGroup>();
        // Where the menu wants a rule drawn, as indices into the finished item list. An inlined
        // group lost its heading to the menu definition, so a separator is what is left to say
        // where one set of actions ends and the next begins. Consecutive submenus need none: they
        // read as one block of "openers" already.
        let separatorAt: number[] = [];
        /** Where each footer submenu wants headings, by its id. */
        const headingsIn = new Map<string, Array<{ index: number; label: string }>>();

        /**
         * Lets go of the menu a previous draw left behind. `addMenuToDropdown` only ever assigns
         * `menuView`, so without this the old one stays in the panel and in the focus tracker and
         * the new one is added beside it.
         */
        const discardMenu = () => {
            const previous = dropdownView.menuView;
            /* v8 ignore next 3 -- only the first draw finds no menu, and it is not a redraw */
            if (!previous) {
                return;
            }
            for (const menu of previous.menus) {
                dropdownView.focusTracker.remove(menu);
            }
            dropdownView.focusTracker.remove(previous);
            /* v8 ignore next -- a menu that was opened is always in the panel it was opened from */
            if (dropdownView.panelView.children.has(previous)) {
                dropdownView.panelView.children.remove(previous);
            }
            previous.destroy();
        };

        const buildMenu = () => {
            actionsById.clear();
            footersById.clear();
            groupsById.clear();
            headingsIn.clear();
            separatorAt = [];

            const groups = this._quickActions;
            const definition: DropdownMenuDefinition = [];

            /** Records a footer row against its id and describes it, opener or leaf, to the menu. */
            const defineFooter = (id: string, footer: AiQuickActionFooter): DropdownMenuDefinition[number] => {
                footersById.set(id, footer);
                if (!footer.children) {
                    return { id, label: footer.label };
                }

                // The headings its children asked for, as indices into the submenu's finished item
                // list — the same bookkeeping the top level does for its rules, and for the same
                // reason: a menu definition carries buttons and submenus, nothing else.
                headingsIn.set(id, footer.children.flatMap((child, index) => (child.heading
                    ? [{ index, label: child.heading }]
                    : [])));

                return {
                    id,
                    menu: footer.label,
                    children: footer.children.map((child, index) => defineFooter(`${id}:${index}`, child))
                };
            };

            // Heads the menu: the typed prompt every row below it is a shortcut past, and what the
            // button half of the split does. Ruled off from them, since it is a way in rather than an
            // instruction.
            definition.push({ id: ASK_ID, label: locale.t("Ask AI…") });
            /* v8 ignore next -- with no groups there is no menu at all: the entry is a plain button */
            if (groups.length) {
                separatorAt.push(definition.length);
            }

            for (const [index, group] of groups.entries()) {
                groupsById.set(group.id, group);
                const children: DropdownMenuDefinition = group.actions.map((action) => {
                    actionsById.set(action.id, action);
                    return { id: action.id, label: action.label };
                });
                if (group.submenu) {
                    if (group.footer) {
                        children.push(defineFooter(`${group.id}:footer`, group.footer));
                    }
                    definition.push({ id: group.id, menu: group.label, children });
                } else {
                    definition.push(...children);
                }

                const next = groups[index + 1];
                if (next && !(group.submenu && next.submenu)) {
                    separatorAt.push(definition.length);
                }
            }

            // What a run answers to, under the instructions that make one.
            if (this._menuFooter.length) {
                separatorAt.push(definition.length);
                definition.push(...this._menuFooter.map((row, index) => defineFooter(`${MENU_FOOTER_ID}:${index}`, row)));
            }

            discardMenu();
            addMenuToDropdown(dropdownView, this.editor.ui.view.body, definition, {
                ariaLabel: locale.t("AI assistant")
            });
        };

        buildMenu();
        dropdownView.class = "ck-ai-assistant-quick-actions";

        // The menu builds its views in `render()`, which `addMenuToDropdown` defers to the first
        // open (through its own `change:isOpen` listener, registered at `highest` priority — so it
        // has already run by the time this one does). There are no buttons to bind before that.
        const decorateMenu = () => {
            /* v8 ignore next -- the menu is built before this runs, as the comment above says */
            for (const button of dropdownView.menuView?.buttons ?? []) {
                if (button.id === ASK_ID) {
                    // A prompt is typed against whatever is there, selection or not, so this row
                    // is never gated the way an instruction about content is.
                    addIcon(button, this.editor.config.get("aiAssistant")?.askIconClass);
                    continue;
                }

                const footer = footersById.get(button.id);
                if (footer) {
                    // A footer configures the group rather than running against the document, so it
                    // stays reachable when everything above it is closed off.
                    addIcon(button, footer.iconClass);
                    continue;
                }

                const action = actionsById.get(button.id);
                if (action?.requiresContent !== false) {
                    button.bind("isEnabled").to(this, "hasContext");
                }
                addIcon(button, action?.iconClass);
            }
            /* v8 ignore next -- as above: no menu, no decoration pass */
            for (const menu of dropdownView.menuView?.menus ?? []) {
                const footer = footersById.get(menu.id);
                if (footer) {
                    // A footer submenu holds settings, not instructions, so nothing about it turns
                    // on there being content to work on.
                    addIcon(menu.buttonView, footer.iconClass);
                    // Back to front, as at the top level: each insertion shifts what follows it.
                    for (const { index, label } of [...(headingsIn.get(menu.id) ?? [])].reverse()) {
                        menu.listView.items.add(new ListHeaderView(locale, label), index);
                    }
                    continue;
                }

                const group = groupsById.get(menu.id);
                addIcon(menu.buttonView, group?.iconClass);
                // A submenu with nothing runnable in it should not invite the pointer: gate the
                // opener on the same context its actions are gated on, unless one of them can run
                // without any — a footer counts, since it runs whatever the selection is. The
                // nested menu binds its own button to this.
                if (!group?.footer && group?.actions.every((action) => action.requiresContent !== false)) {
                    menu.bind("isEnabled").to(this, "hasContext");
                }
                // The footer was appended as the last child; the rule telling it from the actions
                // above goes immediately before it.
                if (group?.footer) {
                    menu.listView.items.add(new ListSeparatorView(locale), menu.listView.items.length - 1);
                }
            }
            // Back to front: each insertion shifts everything after it, and the recorded indices
            // are into the list as the definition built it.
            for (const index of [...separatorAt].reverse()) {
                dropdownView.menuView?.items.add(new ListSeparatorView(locale), index);
            }
        };

        // Everything the menu needs doing happens on the way open: the views to decorate do not
        // exist until then, and a redraw asked for meanwhile is invisible until then anyway. Both
        // are one-shot per menu — hence the flags rather than an unsubscribe, since a redraw makes
        // the work due again.
        let needsDraw = false;
        let needsDecoration = true;
        this._invalidateMenu.push(() => {
            needsDraw = true;
        });
        this.listenTo(dropdownView, "change:isOpen", () => {
            if (!dropdownView.isOpen) {
                return;
            }
            if (needsDraw) {
                // Open, so `addMenuToDropdown` attaches and renders on the spot rather than
                // deferring to an opening that has already happened.
                buildMenu();
                needsDraw = false;
                needsDecoration = true;
            }
            if (needsDecoration) {
                decorateMenu();
                needsDecoration = false;
            }
        });

        // Only the menu items reach this: a split button delegates its own `execute` to itself,
        // and its arrow to the dropdown's `open`. An item inside a submenu arrives here too — it
        // delegates up through its menu to the root — and delegation preserves the original
        // source, so the button (and its id) is the same either way.
        dropdownView.on("execute", (evt) => {
            const id = (evt.source as DropdownMenuListItemButtonView).id;
            if (id === ASK_ID) {
                // Through the command, so this row and the button half arrive by the same road.
                this.editor.execute("aiAssistant");
                return;
            }

            const footer = footersById.get(id);
            if (footer) {
                // A footer that opens onto others has nothing of its own to run.
                footer.run?.();
                return;
            }

            const action = actionsById.get(id);
            /* v8 ignore next -- every button in the menu was built from an action in this map */
            if (action) {
                this.runQuickAction(action);
            }
        });

        return dropdownView;
    }

    public override destroy(): void {
        super.destroy();
        this._abortController?.abort();
        this._formView?.destroy();
    }

    /** Opens the assistant on the current selection. Invoked by the `aiAssistant` command. */
    public show(): void {
        this._open(false);
    }

    /**
     * Opens the assistant and runs a preset instruction against the caret's surroundings. Both
     * entry points to the quick actions — the toolbar menu and the `/` palette — come in this way.
     */
    public runQuickAction(action: AiQuickAction): void {
        // Titled the way the `/` palette names the action: a bare label can be a fragment
        // ("Romanian") that only reads as an instruction beside its group heading.
        this._open(true, action.commandLabel ?? action.label);
        this._reviewView = action.reviewView ?? null;
        void this._run(action.prompt);
    }

    /**
     * @param fallbackToBlock widens a collapsed caret to the block it sits in. A quick action is an
     *                        instruction *about* content ("Fix typos"), so it needs something to
     *                        work on, while a free-form prompt typed at a collapsed caret
     *                        legitimately means "generate here" and must keep an empty context.
     * @param title names the run in the dialog's header, for a quick action. Defaults to the
     *              feature's own name, which is all a free-form prompt can be called.
     */
    private _open(fallbackToBlock: boolean, title?: string): void {
        const editor = this.editor;
        const dialog = editor.plugins.get(Dialog);
        const form = this._getForm();
        const heading = title ?? editor.t("AI assistant");

        if (dialog.id === DIALOG_ID) {
            this._setTitle(heading);
            form.focus();
            return;
        }

        // Capture the context and pin the target before focus moves into the dialog and the
        // document selection stops being trustworthy.
        const model = editor.model;
        const range = this._resolveTargetRange(fallbackToBlock);
        this._context = !range || range.isCollapsed
            ? ""
            : editor.data.stringify(model.getSelectedContent(model.createSelection(range)));
        this._openingContext = this._context;
        this._surroundings = this._captureSurroundings(range);
        this._previousContext = this._context;
        this._history = [];
        this._previousHistory = [];
        this._cumulative = "";
        this._cumulativeSource = "";
        this._updateHasContext();

        /* v8 ignore next -- the document selection always has at least one range */
        if (range) {
            model.change((writer) => {
                writer.addMarker(AI_TARGET_MARKER, { range, usingOperation: false, affectsData: false });
            });
        }

        form.reset();
        dialog.show({
            id: DIALOG_ID,
            // A header is what makes the dialog draggable, so the user can move it off the text
            // being rewritten.
            title: heading,
            icon: aiIcon,
            isModal: false,
            position: DialogViewPosition.EDITOR_CENTER,
            content: form,
            // Covers every way out — Esc, the close button, another dialog taking over — not just
            // the paths that go through `_hide()`.
            onHide: () => this._reset()
        });
        form.focus();
    }

    /**
     * Retitles the dialog while it stands. `show()` takes the title only once, so a quick action
     * picked over an already-open assistant has to write to the header itself — and to the aria
     * label, which the dialog otherwise derives from the same string.
     */
    private _setTitle(title: string): void {
        const view = this.editor.plugins.get(Dialog).view;
        /* v8 ignore next -- every call site has just established that the dialog is open */
        if (!view?.headerView) {
            return;
        }
        view.headerView.label = title;
        view.ariaLabel = title;
    }

    private _getForm(): AiAssistantFormView {
        if (this._formView) {
            return this._formView;
        }

        const editor = this.editor;
        const form = new AiAssistantFormView(editor.locale, {
            onResultRendered: (preview) => this._enrichPreview(preview)
        });
        this._formView = form;
        form.setPicker(this._pickerRow());

        form.on("submit", () => {
            const query = form.query.trim();
            if (query) {
                form.query = "";
                // A typed follow-up is no longer the quick action that opened the assistant, so
                // the header stops claiming to be one — and its review view goes with it.
                this._setTitle(editor.t("AI assistant"));
                this._reviewView = null;
                void this._run(query);
            }
        });
        form.on("stop", () => this._abortController?.abort());
        form.on("replace", () => this._commit("replace"));
        form.on("insertBelow", () => this._commit("insertBelow"));
        form.on("tryAgain", () => {
            // Retry against what the last run saw, not against its own output — so the exchange
            // being retried leaves the conversation along with the response it produced.
            this._context = this._previousContext;
            this._history = this._previousHistory;
            void this._run(this._lastQuery);
        });

        // Esc and the close button are the dialog's own; it also stays put as the preview grows
        // and when the Result/Changes toggle changes its height, so there is nothing to reposition
        // and no click-outside dismissal that could throw a streamed response away.
        return form;
    }

    private async _run(query: string): Promise<void> {
        const editor = this.editor;
        const stream = editor.config.get("aiAssistant")?.stream;
        const form = this._getForm();
        /* v8 ignore next -- the command is disabled without a stream, and the form blocks submits while streaming */
        if (!stream || this.isStreaming) {
            return;
        }

        this._previousContext = this._context;
        this._previousHistory = this._history;
        this._lastQuery = query;
        this.isStreaming = true;
        this._cumulative = "";
        this._cumulativeSource = "";
        form.beginStreaming();

        const abortController = new AbortController();
        this._abortController = abortController;

        const render = (html: string) => form.setPreview(this._sanitize(html));

        let renderTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingHtml: string | null = null;
        const onData = (cumulative: string, source?: string) => {
            this._cumulative = cumulative;
            this._cumulativeSource = source ?? cumulative;
            if (renderTimer) {
                pendingHtml = cumulative;
                return;
            }
            render(cumulative);
            renderTimer = setTimeout(() => {
                renderTimer = null;
                if (pendingHtml !== null) {
                    const html = pendingHtml;
                    pendingHtml = null;
                    render(html);
                }
            }, RENDER_THROTTLE_MS);
        };

        let errorMessage = "";
        let usage: AiCompletionUsage | null = null;
        try {
            usage = (await stream(
                {
                    query,
                    context: this._openingContext,
                    surroundings: this._surroundings,
                    history: this._history
                },
                onData,
                abortController.signal
            )) ?? null;
        } catch (error) {
            // An abort is the user's Stop: whatever already streamed stays reviewable.
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                errorMessage = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (renderTimer) {
                clearTimeout(renderTimer);
                renderTimer = null;
            }
            if (pendingHtml !== null) {
                render(pendingHtml);
            }
            this.isStreaming = false;
            this._abortController = null;
        }

        if (this._cumulative) {
            // Follow-up queries chain on the response ("now make it shorter"), premium-style — and
            // the exchange joins the conversation the next one is asked in, so the instruction
            // behind the response is still on the record when the response is refined. Without it
            // "translate this to German" followed by "make it shorter" shortens in English.
            this._context = this._cumulative;
            this._history = [
                ...this._history,
                { role: "user", content: query },
                { role: "assistant", content: this._cumulativeSource }
            ];
        }
        // A response counts as content, so content-requiring quick actions unlock for chaining.
        this._updateHasContext();

        const diff = this._buildDiff();
        form.enterReview({
            hasContent: !!this._cumulative,
            // A response that changed nothing has a diff with no marks in it, which reads as a
            // diff that failed. The review says so in words instead, and offers no view of it.
            diffHtml: diff?.isUnchanged ? null : diff?.html,
            isUnchanged: diff?.isUnchanged,
            errorMessage,
            usageText: this._formatUsage(usage),
            viewMode: this._resolveReviewView(diff)
        });
    }

    /**
     * Which view the finished run opens on: whatever the quick action asked for, and otherwise
     * what the diff makes of the response — a rewrite the differ could barely align is shown as
     * the result, since the marks would outnumber the text they are on.
     */
    private _resolveReviewView(diff: AiDiffResult | null): AiReviewView {
        if (this._reviewView) {
            return this._reviewView;
        }
        return (diff?.rewriteRatio ?? 0) > REWRITE_RATIO_THRESHOLD ? "result" : "changes";
    }

    /**
     * The review's cost line, e.g. `claude-sonnet-5 · 1,234 tokens · ~$0.0042`. Only the fields
     * the provider reported are shown; an aborted or failed run has none at all.
     */
    private _formatUsage(usage: AiCompletionUsage | null): string {
        if (!usage) {
            return "";
        }
        const parts: string[] = [];
        if (usage.model) {
            parts.push(usage.model);
        }
        if (usage.totalTokens != null) {
            parts.push(`${usage.totalTokens.toLocaleString()} ${this.editor.t("tokens")}`);
        }
        if (usage.cost != null) {
            // A single completion usually costs well under a cent; two decimals would show $0.00.
            parts.push(`~$${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}`);
        }
        return parts.join(" · ");
    }

    /**
     * Makes model-produced HTML safe to render, through the host's sanitizer — Trilium passes the
     * DOMPurify pass it already applies to note content.
     *
     * There is no fallback on purpose: CKEditor ships no sanitizer, and a strip list written here
     * would only look like one. A host that streams model output without configuring one is
     * misconfigured, so the assistant refuses to run rather than render it unsanitized.
     */
    private _sanitize(html: string): string {
        const sanitize = this.editor.config.get("aiAssistant")?.sanitizeHtml;
        if (!sanitize) {
            throw new CKEditorError("ai-assistant-sanitize-html-required", { pluginName: "AiAssistantUI" });
        }
        return sanitize(html);
    }

    /**
     * Everything a finished response holds that is content in source form until the editor sees it.
     * The response is note HTML rendered from Markdown, and the editor turns such a source into the
     * thing it denotes only when the content is upcast into the model — which the assistant
     * deliberately postpones until commit, so the preview has to do it for itself or the review
     * shows the source where the note will show a diagram or an equation.
     */
    private _enrichPreview(preview: HTMLElement): void {
        this._renderPreviewDiagrams(preview);
        this._renderPreviewMath(preview);
    }

    /**
     * Typesets the equations of a finished response, in place. In note HTML an equation is a
     * `math-tex` span holding its own LaTeX source, delimiters and all — which is exactly what the
     * preview showed: `\(c^2 = a^2 + b^2\)`, printed rather than set.
     *
     * The renderer is the Math feature's own, so the engine, the lazy load and the macro set are
     * the ones the note is typeset with. Without a `math` config there is nothing to typeset with
     * and the source stands, as it does for a build without the feature.
     */
    private _renderPreviewMath(preview: HTMLElement): void {
        const math = this.editor.config.get("math");
        if (!math) {
            return;
        }

        for (const span of preview.querySelectorAll<HTMLElement>("span.math-tex")) {
            /* v8 ignore next -- defensive fallback: textContent on an element is always a string */
            const { equation, display } = extractDelimiters(span.textContent ?? "");
            void renderEquation(
                equation, span, math.engine, math.lazyLoad, display,
                // Not a preview in the Math feature's sense: that is the balloon's live rendering
                // of an equation being typed, which mounts into a element of its own.
                false, "", math.previewClassName, math.katexRenderOptions
            );
        }
    }

    /**
     * Turns the `language-mermaid` code blocks of a finished response into rendered diagrams, so
     * the review shows what committing it will show. The response is Markdown rendered to note
     * HTML, in which a diagram is a code block — the editor only makes one a diagram when the
     * content is upcast into the model, which the assistant deliberately postpones until commit.
     *
     * Soft-coupled to the Mermaid feature by name: a build without it — or one whose host supplies
     * no diagram library — leaves the source standing, which is also all a commit could produce
     * there, rather than emptying the block in favour of a diagram that will never arrive.
     */
    private _renderPreviewDiagrams(preview: HTMLElement): void {
        const editor = this.editor;
        if (!editor.plugins.has("MermaidEditing") || !editor.config.get("mermaid")?.lazyLoad) {
            return;
        }

        const mermaid = editor.plugins.get("MermaidEditing");
        // The `<pre>` is replaced along with the `<code>` it holds: a diagram left inside one is
        // framed as a code block in the preview and nowhere else.
        for (const pre of preview.querySelectorAll("pre:has(> code.language-mermaid)")) {
            /* v8 ignore next -- defensive fallback: textContent on an element is always a string */
            const source = pre.textContent ?? "";
            const diagram = preview.ownerDocument.createElement("div");
            diagram.className = "ck-ai-assistant-form__diagram";
            pre.replaceWith(diagram);
            void mermaid.renderMermaid(diagram, source);
        }
    }

    /**
     * The "Changes" view of the review: the finished response diffed against the context the run
     * saw (`_previousContext` — so a follow-up query diffs against the response it refined, not
     * the original selection). Only computed once the stream is complete; diffing a partial
     * response would render everything not yet streamed as deleted. Null when the host provides
     * no diff renderer or there is nothing to diff against (generate-from-scratch).
     */
    private _buildDiff(): AiDiffResult | null {
        const diff = this.editor.config.get("aiAssistant")?.diff;
        if (!diff || !this._cumulative || !this._previousContext) {
            return null;
        }
        try {
            // A renderer may answer with the diff alone or with the diff and what it made of it.
            const result = diff(this._previousContext, this._cumulative);
            const normalized: AiDiffResult = typeof result === "string" ? { html: result } : result;
            return { ...normalized, html: this._sanitize(normalized.html) };
        } catch (error) {
            // A host diff failure only costs the Changes view, never the response itself.
            console.warn("AI assistant: diff renderer failed", error);
            return null;
        }
    }

    /**
     * The single write to the document: parses the final response through the data pipeline (the
     * schema drops anything the editor cannot represent) and inserts it at the pinned target.
     */
    private _commit(mode: "replace" | "insertBelow"): void {
        const editor = this.editor;
        const html = this._cumulative;
        /* v8 ignore next -- the commit buttons are only visible in the review phase, which requires content */
        if (!html) {
            return;
        }

        const modelFragment = editor.data.toModel(editor.data.processor.toView(this._sanitize(html)));
        const model = editor.model;

        model.change((writer) => {
            const target = this._getTargetRange();
            /* v8 ignore next 3 -- the marker is gone at worst, and the selection always has a range */
            if (!target) {
                return;
            }
            // Retired here rather than left to the teardown, which hands the pinned range back as
            // the selection: `insertContent` decides where the selection lands after a commit, and
            // restoring the range it just wrote over would overrule it. Same change, so the marker
            // goes with the insertion in a single undo step.
            if (model.markers.has(AI_TARGET_MARKER)) {
                writer.removeMarker(AI_TARGET_MARKER);
            }
            if (mode === "replace") {
                model.insertContent(modelFragment, target);
            } else {
                // After the outermost block containing the target's end, so "Insert below" lands
                // below the whole selection rather than inside it.
                let block: ModelNode | null = target.end.parent as ModelNode;
                while (block && block.parent && !block.parent.is("rootElement")) {
                    block = block.parent as ModelNode;
                }
                if (block && !block.is("rootElement")) {
                    model.insertContent(modelFragment, writer.createPositionAfter(block));
                } else {
                    /* v8 ignore next -- a target ending in the root is already past a block, and
                       lands in the same place either way */
                    model.insertContent(modelFragment, target.end);
                }
            }
        });

        this._hide();
    }

    private _getTargetRange(): ModelRange | null {
        const model = this.editor.model;
        const marker = model.markers.has(AI_TARGET_MARKER) ? model.markers.get(AI_TARGET_MARKER) : null;
        return marker?.getRange() ?? model.document.selection.getFirstRange() ?? null;
    }

    /** Closes the assistant. The teardown itself rides on the dialog's `onHide`. */
    private _hide(): void {
        const dialog = this.editor.plugins.get(Dialog);
        // Only our own: `hide()` closes whatever dialog is open, and another feature's must not be
        // collateral damage.
        /* v8 ignore next -- another feature taking the dialog over already tore this one down */
        if (dialog.id === DIALOG_ID) {
            dialog.hide();
        }
    }

    /**
     * Returns the plugin to its closed state. Invoked from the dialog's `onHide`, so it runs
     * however the assistant was dismissed. The dialog handles removing the form and restoring
     * focus to the editing view.
     */
    private _reset(): void {
        const editor = this.editor;

        this._abortController?.abort();
        this._cumulative = "";
        this._cumulativeSource = "";
        // Dropping the captured context hands the quick actions back to the selection; keeping it
        // would leave them enabled over a closed assistant that has nothing to work on.
        this._context = "";
        this._openingContext = "";
        this._surroundings = EMPTY_SURROUNDINGS;
        this._previousContext = "";
        // The conversation was the dialog's: the next one opens on a fresh selection, with nothing
        // the model should still be answering in the light of.
        this._history = [];
        this._previousHistory = [];
        this._reviewView = null;
        this._updateHasContext();

        const marker = editor.model.markers.get(AI_TARGET_MARKER);
        if (marker) {
            // Hand the pinned range back as the selection. The marker is what showed the target
            // for as long as the dialog stood — the editable was blurred throughout, so the
            // selection was neither on show nor under anyone's control — and dropping it without
            // this leaves whatever the selection decayed to meanwhile.
            const range = marker.getRange();
            editor.model.change((writer) => {
                writer.removeMarker(AI_TARGET_MARKER);
                writer.setSelection(range);
            });
        }
        this._formView?.reset();
    }

    /**
     * What the quick actions are offered against: whatever the assistant captured while open, or
     * once it is closed, whatever a run started now would work on.
     */
    private _updateHasContext(): void {
        const range = this._resolveTargetRange(true);
        this.hasContext = !!this._context || (!!range && !range.isCollapsed);
    }

    /**
     * The rest of the note either side of the target, as plain text — what tells the model where in
     * the note it is writing. A selection alone does not: "continue this" and "summarize this" both
     * read differently under a heading than they do in a note's opening paragraph.
     *
     * Captured once, with the context, and unchanged for the conversation: the document is not
     * modified until a response is committed, and a commit closes the assistant.
     */
    private _captureSurroundings(target: ModelRange | null): AiSurroundings {
        const model = this.editor.model;
        const root = model.document.getRoot();
        /* v8 ignore next 3 -- the target always resolves, and an editor always has a main root */
        if (!target || !root) {
            return EMPTY_SURROUNDINGS;
        }

        const before = model.createRange(model.createPositionAt(root, 0), target.start);
        const after = model.createRange(target.end, model.createPositionAt(root, "end"));
        return {
            // Each side keeps the part nearest the target: the paragraph just above the selection
            // says far more about it than the note's first one does.
            before: clampText(this._plainText(before), "end"),
            after: clampText(this._plainText(after), "start")
        };
    }

    /**
     * A range of the document as plain text, one line per block. Blocks are what the model has to
     * see — that a heading opens the passage, that the lines around it are list items — and the
     * markup carrying them is worth nothing to content nobody is asking it to rewrite.
     */
    private _plainText(range: ModelRange): string {
        const schema = this.editor.model.schema;
        let text = "";

        for (const { type, item } of range.getWalker()) {
            if (item.is("$textProxy")) {
                text += item.data;
            } else if (type === "elementEnd" && item.is("element") && schema.isBlock(item)) {
                text += "\n";
            }
        }

        // A range that starts or ends inside a block leaves that block's own line unclosed, and
        // nested blocks close one line per level; neither is worth showing as a blank line.
        return text.replace(/\n{2,}/g, "\n").trim();
    }

    /**
     * The range a run works on: the selection, or — for a quick action at a collapsed caret — the
     * block it sits in, so "Fix typos" typed into a paragraph rewrites that paragraph. It is both
     * the context handed to the model and what the target marker pins for "Replace".
     */
    private _resolveTargetRange(fallbackToBlock: boolean): ModelRange | null {
        const model = this.editor.model;
        const selection = model.document.selection;
        const range = selection.getFirstRange();

        if (!fallbackToBlock || !selection.isCollapsed) {
            return range;
        }

        const block = selection.getFirstPosition()?.parent;
        /* v8 ignore next -- a collapsed selection always sits inside an element */
        return block?.is("element") ? model.createRangeIn(block) : range;
    }
}

/**
 * Trims one side of the surroundings to {@link SURROUNDINGS_LIMIT}, keeping the end nearest the
 * target and cutting on a line break so the model is never handed half a sentence as if it were a
 * whole one.
 *
 * @param keep which end survives: `"end"` for the text before the target, `"start"` for the text
 *             after it.
 */
function clampText(text: string, keep: "start" | "end"): string {
    if (text.length <= SURROUNDINGS_LIMIT) {
        return text;
    }

    if (keep === "start") {
        const cut = text.slice(0, SURROUNDINGS_LIMIT);
        const lastBreak = cut.lastIndexOf("\n");
        return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd();
    }

    const cut = text.slice(-SURROUNDINGS_LIMIT);
    const firstBreak = cut.indexOf("\n");
    return (firstBreak >= 0 ? cut.slice(firstBreak + 1) : cut).trimStart();
}

/**
 * Puts a font icon in front of a menu button's label. The menu definition has no icon field and
 * CKEditor builds these views itself, so the glyph is added to the button's children afterwards —
 * the same after-render mutation the snippet list does, and safe because a `ViewCollection` bound
 * to a rendered element renders whatever is added to it.
 */
function addIcon(button: ButtonView, iconClass: string | undefined): void {
    if (iconClass) {
        button.children.add(new FontIconView(button.locale, iconClass), 0);
    }
}

/**
 * A heading over a block of rows, in the markup CKEditor styles its own list groups with — bold,
 * small, ruled off from the block above.
 *
 * `ListItemGroupView` would bring the same look but wants to *own* the rows under it, and the menu
 * builds those from a definition that has no notion of a group. A heading inserted beside them,
 * the way the separators are, needs no such ownership. It is presentational: the rows keep their
 * own roles, and a screen reader is not told a menu item sits here.
 */
class ListHeaderView extends View {

    constructor(locale: Locale | undefined, label: string) {
        super(locale);

        this.setTemplate({
            tag: "li",
            attributes: { class: ["ck", "ck-list__group"], role: "presentation" },
            children: [{
                tag: "span",
                attributes: { class: ["ck", "ck-label"] },
                children: [{ text: label }]
            }]
        });
    }
}

/**
 * An icon-pack glyph as a plain `<span>`. CKEditor's `IconView` takes SVG source, which a font
 * icon has none of; Trilium owns this plugin, so the class list can be rendered directly.
 */
class FontIconView extends View {

    constructor(locale: Locale | undefined, iconClass: string) {
        super(locale);

        this.setTemplate({
            tag: "span",
            attributes: { class: ["ck-ai-action-icon", ...iconClass.split(" ")] }
        });
    }
}

/**
 * Whether the toolbar entry can be used: the command is enabled (an LLM provider is configured)
 * and no run is in flight.
 */
function isAvailable(isEnabled: boolean, isStreaming: boolean): boolean {
    return isEnabled && !isStreaming;
}
