import {
    addListToDropdown,
    ButtonView,
    Collection,
    createDropdown,
    createLabeledInputText,
    FocusCycler,
    FocusTracker,
    KeystrokeHandler,
    LabeledFieldView,
    submitHandler,
    View,
    ViewCollection,
    ViewModel,
    type DropdownView,
    type FocusableView,
    type InputTextView,
    type ListDropdownButtonDefinition,
    type ListDropdownItemDefinition,
    type Locale
} from "ckeditor5";

import type { AiQuickAction, AiQuickActionGroup } from "./ai_assistant_config.js";

/** Resolves a translation key, falling back to the given English text. See `translate.ts`. */
type Translate = (key: string, fallback: string) => string;

/**
 * Where the form is in its lifecycle: taking a prompt, streaming a response into the preview, or
 * showing a finished response for review (Replace / Insert below / Try again). The prompt row stays
 * usable in the review phase so a follow-up query can chain on the response.
 */
export type AiAssistantFormPhase = "prompt" | "streaming" | "review";

/** What the preview shows in the review phase: the response, or its diff against the context. */
export type AiAssistantViewMode = "result" | "changes";

/** Fired when the user picks an entry in the "Quick actions" dropdown. */
export type AiQuickActionEvent = {
    name: "quickAction";
    args: [action: AiQuickAction];
};

/**
 * The AI assistant balloon: a prompt row, a read-only streaming preview styled like note content,
 * and the review actions. In the review phase the preview can toggle between the plain result and
 * an inline diff ("Changes"), when the host provides a diff renderer. Purely presentational — the
 * orchestration (markers, streaming, diffing, committing to the model) lives in `AiAssistantUI`,
 * which listens to this view's `submit`, `stop`, `replace`, `insertBelow` and `tryAgain` events.
 */
export default class AiAssistantFormView extends View {

    declare public phase: AiAssistantFormPhase;
    /** The instruction typed by the user; two-way bound to the input field. */
    declare public query: string;
    /** A transport/provider failure to surface; empty string when there is none. */
    declare public errorMessage: string;
    /** Which of the stored contents the preview shows. Only meaningful in the review phase. */
    declare public viewMode: AiAssistantViewMode;
    /** Whether the current review has a diff to offer; controls the view-mode toggle. */
    declare public hasDiff: boolean;
    /** The run's cost line ("model · tokens · price"), shown in the review actions row. */
    declare public usageText: string;
    /**
     * Whether there is content for a quick action to work on — the captured selection, or after a
     * run, the response being chained on. Gates the `requiresContent` quick actions.
     */
    declare public hasContext: boolean;

    /** The (sanitized) response HTML, kept for re-rendering when the view mode flips. */
    private _resultHtml = "";
    /** The (sanitized) diff HTML of the review phase, when the host provided one. */
    private _diffHtml = "";

    public readonly promptInputView: LabeledFieldView<InputTextView>;
    public readonly sendButtonView: ButtonView;
    public readonly quickActionsDropdownView: DropdownView;
    public readonly resultToggleView: ButtonView;
    public readonly changesToggleView: ButtonView;
    public readonly previewView: AiPreviewView;
    public readonly stopButtonView: ButtonView;
    public readonly replaceButtonView: ButtonView;
    public readonly insertBelowButtonView: ButtonView;
    public readonly tryAgainButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly _focusables = new ViewCollection<FocusableView>();
    private readonly _focusCycler: FocusCycler;

    constructor(locale: Locale, translate: Translate, quickActions: AiQuickActionGroup[] = []) {
        super(locale);

        this.set("phase", "prompt");
        this.set("query", "");
        this.set("errorMessage", "");
        this.set("viewMode", "result");
        this.set("hasDiff", false);
        this.set("usageText", "");
        this.set("hasContext", false);

        // Re-render the preview from the stored contents whenever the toggle flips.
        this.on("change:viewMode", () => this._renderPreview());

        this.resultToggleView = this._createViewModeButton(locale, translate("ai_assistant.result", "Result"), "result");
        this.changesToggleView = this._createViewModeButton(locale, translate("ai_assistant.changes", "Changes"), "changes");
        this.quickActionsDropdownView = this._createQuickActionsDropdown(locale, translate, quickActions);
        this.promptInputView = this._createPromptInput(locale, translate);
        this.sendButtonView = this._createSendButton(locale, translate);
        this.previewView = new AiPreviewView(locale);
        this.previewView.bind("isVisible").to(this, "phase", (phase) => phase !== "prompt");

        this.stopButtonView = this._createActionButton(locale, translate("ai_assistant.stop", "Stop"), "streaming", "stop");
        this.replaceButtonView = this._createActionButton(locale, translate("ai_assistant.replace", "Replace"), "review", "replace");
        this.replaceButtonView.class = "ck-button-action";
        this.insertBelowButtonView = this._createActionButton(locale, translate("ai_assistant.insert_below", "Insert below"), "review", "insertBelow");
        this.tryAgainButtonView = this._createActionButton(locale, translate("ai_assistant.try_again", "Try again"), "review", "tryAgain");

        const bind = this.bindTemplate;

        this.setTemplate({
            tag: "form",
            attributes: {
                class: ["ck", "ck-ai-assistant-form", "ck-responsive-form"],
                tabindex: "-1"
            },
            children: [
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__heading"] },
                    children: [
                        {
                            tag: "span",
                            attributes: { class: ["ck", "ck-ai-assistant-form__title"] },
                            children: [{ text: translate("ai_assistant.title", "AI assistant") }]
                        },
                        this.resultToggleView,
                        this.changesToggleView
                    ]
                },
                this.previewView,
                {
                    tag: "div",
                    attributes: {
                        class: [
                            "ck",
                            "ck-ai-assistant-form__error",
                            bind.if("errorMessage", "ck-hidden", (message) => !message)
                        ]
                    },
                    children: [{ text: bind.to("errorMessage") }]
                },
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__prompt-row"] },
                    children: [this.quickActionsDropdownView, this.promptInputView, this.sendButtonView]
                },
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__actions"] },
                    children: [
                        this.stopButtonView,
                        this.replaceButtonView,
                        this.insertBelowButtonView,
                        this.tryAgainButtonView,
                        {
                            tag: "span",
                            attributes: {
                                class: [
                                    "ck",
                                    "ck-ai-assistant-form__usage",
                                    bind.if("usageText", "ck-hidden", (text) => !text)
                                ]
                            },
                            children: [{ text: bind.to("usageText") }]
                        }
                    ]
                }
            ]
        });

        this._focusCycler = new FocusCycler({
            focusables: this._focusables,
            focusTracker: this.focusTracker,
            keystrokeHandler: this.keystrokes,
            actions: {
                focusPrevious: "shift + tab",
                focusNext: "tab"
            }
        });
    }

    public override render(): void {
        super.render();

        // Turns a native form submit (the Enter key included) into the view's own `submit` event.
        submitHandler({ view: this });

        const focusables = [
            this.resultToggleView,
            this.changesToggleView,
            this.quickActionsDropdownView,
            this.promptInputView,
            this.sendButtonView,
            this.stopButtonView,
            this.replaceButtonView,
            this.insertBelowButtonView,
            this.tryAgainButtonView
        ];
        for (const view of focusables) {
            this._focusables.add(view);
            /* v8 ignore next -- a child view rendered as part of this template always has an element */
            if (view.element) {
                this.focusTracker.add(view.element);
            }
        }

        /* v8 ignore next -- super.render() has just built this view's element */
        if (this.element) {
            this.keystrokes.listenTo(this.element);
        }
    }

    public override destroy(): void {
        super.destroy();
        this.focusTracker.destroy();
        this.keystrokes.destroy();
    }

    /** Puts the form back in its blank prompt state, ready for the next opening. */
    public reset(): void {
        this.phase = "prompt";
        this.query = "";
        this.errorMessage = "";
        this._resultHtml = "";
        this._diffHtml = "";
        this.hasDiff = false;
        this.viewMode = "result";
        this.usageText = "";
        this._renderPreview();
    }

    /** Enters the streaming phase with an empty preview. Streaming always shows the raw result. */
    public beginStreaming(): void {
        this.phase = "streaming";
        this.errorMessage = "";
        this._resultHtml = "";
        this._diffHtml = "";
        this.hasDiff = false;
        this.viewMode = "result";
        this.usageText = "";
        this._renderPreview();
    }

    /** Renders the (sanitized, cumulative) response received so far. */
    public setPreview(html: string): void {
        this._resultHtml = html;
        this._renderPreview();
    }

    /**
     * Leaves the streaming phase. With content the form enters review — defaulting to the
     * "Changes" view when a diff is available — while a run that produced nothing falls back to
     * the prompt phase, showing `errorMessage` when the run failed.
     */
    public enterReview(hasContent: boolean, diffHtml: string | null, errorMessage: string, usageText = ""): void {
        this.phase = hasContent ? "review" : "prompt";
        this.errorMessage = errorMessage;
        this._diffHtml = diffHtml ?? "";
        this.hasDiff = hasContent && !!this._diffHtml;
        this.viewMode = this.hasDiff ? "changes" : "result";
        this.usageText = hasContent ? usageText : "";
        this._renderPreview();
    }

    public focus(): void {
        this._focusCycler.focusFirst();
    }

    /** Shows whichever stored content the current view mode selects. */
    private _renderPreview(): void {
        this.previewView.setContent(this.viewMode === "changes" && this._diffHtml ? this._diffHtml : this._resultHtml);
    }

    /**
     * The grouped "Quick actions" dropdown. Picking an entry fires `quickAction` with its
     * {@link AiQuickAction} — the orchestrator runs its prompt as if it had been typed. Actions
     * marked `requiresContent` are disabled while there is nothing to work on. Hidden entirely
     * when the host configured no actions.
     */
    private _createQuickActionsDropdown(locale: Locale, translate: Translate, groups: AiQuickActionGroup[]) {
        const dropdown = createDropdown(locale);

        dropdown.buttonView.set({
            label: translate("ai_assistant.quick_actions", "Quick actions"),
            withText: true
        });
        // DropdownView has no `isVisible`; an empty action list hides the component wholesale.
        if (!groups.length) {
            dropdown.class = "ck-hidden";
        }
        dropdown.bind("isEnabled").to(this, "phase", (phase) => phase !== "streaming");

        const items = new Collection<ListDropdownItemDefinition>();
        for (const group of groups) {
            const children = new Collection<ListDropdownButtonDefinition>();
            for (const action of group.actions) {
                const definition: ListDropdownButtonDefinition = {
                    type: "button",
                    model: new ViewModel({
                        _quickAction: action,
                        label: action.label,
                        withText: true
                    })
                };
                if (action.requiresContent !== false) {
                    definition.model.bind("isEnabled").to(this, "hasContext");
                }
                children.add(definition);
            }
            items.add({ type: "group", label: group.label, items: children });
        }
        addListToDropdown(dropdown, items);

        dropdown.on("execute", (evt) => {
            this.fire<AiQuickActionEvent>("quickAction", (evt.source as unknown as { _quickAction: AiQuickAction })._quickAction);
        });

        return dropdown;
    }

    /** One half of the Result/Changes toggle, visible only when a review has a diff to offer. */
    private _createViewModeButton(locale: Locale, label: string, mode: AiAssistantViewMode) {
        const button = new ButtonView(locale);
        button.set({ label, withText: true, isToggleable: true, class: "ck-ai-assistant-form__viewmode" });
        button.bind("isOn").to(this, "viewMode", (viewMode) => viewMode === mode);
        button.bind("isVisible").to(
            this, "phase",
            this, "hasDiff",
            (phase, hasDiff) => phase === "review" && hasDiff
        );
        button.on("execute", () => {
            this.viewMode = mode;
        });
        return button;
    }

    private _createPromptInput(locale: Locale, translate: Translate) {
        const input = new LabeledFieldView(locale, createLabeledInputText);
        input.label = translate("ai_assistant.prompt_label", "Ask AI to…");

        // Two-way: the field drives `query`, and reset() drives the field.
        input.fieldView.bind("value").to(this, "query");
        input.fieldView.on("input", () => {
            /* v8 ignore next -- the input event can only come from a rendered element */
            this.query = input.fieldView.element?.value ?? "";
        });
        input.bind("isEnabled").to(this, "phase", (phase) => phase !== "streaming");

        return input;
    }

    private _createSendButton(locale: Locale, translate: Translate) {
        const button = new ButtonView(locale);
        button.set({
            label: translate("ai_assistant.send", "Send"),
            withText: true,
            type: "submit",
            class: "ck-button-action ck-button-bold"
        });
        button.bind("isEnabled").to(
            this, "query",
            this, "phase",
            (query, phase) => !!String(query).trim() && phase !== "streaming"
        );
        return button;
    }

    /** A text action button that is only visible in the given phase and re-emits `eventName`. */
    private _createActionButton(locale: Locale, label: string, phase: AiAssistantFormPhase, eventName: string) {
        const button = new ButtonView(locale);
        button.set({ label, withText: true });
        button.bind("isVisible").to(this, "phase", (currentPhase) => currentPhase === phase);
        button.on("execute", () => this.fire(eventName));
        return button;
    }
}

/**
 * The streaming preview: a plain non-editable `div` carrying the `ck-content` class so the
 * response renders with the same styles it will have once inserted into the note.
 *
 * The content is assigned through `innerHTML` on purpose — the stream delivers a growing HTML
 * prefix, and the browser's parser auto-closes elements cut off mid-stream, so every tick renders
 * something sensible without any incremental DOM diffing. Callers sanitize before handing HTML in.
 */
class AiPreviewView extends View {

    declare public isVisible: boolean;

    constructor(locale: Locale) {
        super(locale);
        this.set("isVisible", false);

        const bind = this.bindTemplate;
        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-ai-assistant-form__preview",
                    "ck-content",
                    // Exempt the preview subtree from CKEditor's UI reset — inside the balloon,
                    // `.ck-reset_all` otherwise forces `white-space: nowrap` (plus zeroed margins
                    // and the UI font) onto the content, making every paragraph one long
                    // unwrappable line.
                    "ck-reset_all-excluded",
                    bind.if("isVisible", "ck-hidden", (isVisible) => !isVisible)
                ]
            }
        });
    }

    public setContent(html: string): void {
        const element = this.element;
        /* v8 ignore next -- the preview is only written to after the form has rendered */
        if (!element) {
            return;
        }

        // Follow the stream unless the user has scrolled up to read something.
        const wasAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 24;
        element.innerHTML = html;
        if (wasAtBottom) {
            element.scrollTop = element.scrollHeight;
        }
    }
}
