import { IconArrowUp, IconCheck, IconRefresh, IconStop } from "@ckeditor/ckeditor5-icons";
import {
    addListToDropdown,
    ButtonView,
    Collection,
    createDropdown,
    FocusCycler,
    FocusTracker,
    IconView,
    InputTextView,
    KeystrokeHandler,
    submitHandler,
    UIModel,
    View,
    ViewCollection,
    type DropdownView,
    type FocusableView,
    type ListDropdownButtonDefinition,
    type ListDropdownItemDefinition,
    type Locale
} from "ckeditor5";

import type { AiQuickActionFooter, AiReviewView } from "./ai_assistant_config.js";

/**
 * Where the form is in its lifecycle: taking a prompt, streaming a response into the preview, or
 * showing a finished response for review (Replace / Insert below / Try again). The prompt row stays
 * usable in the review phase so a follow-up query can chain on the response.
 */
export type AiAssistantFormPhase = "prompt" | "streaming" | "review";

/** The hooks the orchestrating plugin hangs on the form, which is otherwise self-contained. */
export interface AiAssistantFormOptions {
    /**
     * Called with the preview element whenever it has just been filled with a finished response —
     * the point at which content that only renders as itself once processed (a Mermaid diagram)
     * can be turned into what the note will show. See {@link AiAssistantFormView._renderPreview}
     * for why the streaming and diff renders are not offered.
     */
    onResultRendered?: (preview: HTMLElement) => void;
}

/** What a finished run leaves the form showing. */
export interface AiReviewOptions {
    /** Whether the run produced anything at all; without it the form falls back to the prompt. */
    hasContent: boolean;
    /** The (sanitized) diff of the response against what it would replace, when there is one. */
    diffHtml?: string | null;
    /** A transport/provider failure to surface; empty when the run succeeded. */
    errorMessage?: string;
    /** The run's cost line ("model · tokens · price"). */
    usageText?: string;
    /** Which view to open on. Defaults to "changes" whenever there is a diff to show. */
    viewMode?: AiReviewView;
    /** Whether the response came back as the content it was given, which the review says outright. */
    isUnchanged?: boolean;
}

/**
 * The AI assistant dialog's contents: a prompt row, a read-only streaming preview styled like note
 * content, and the review actions. In the review phase the preview can toggle between the plain result and
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
    declare public viewMode: AiReviewView;
    /** Whether the current review has a diff to offer; controls the view-mode toggle. */
    declare public hasDiff: boolean;
    /** Whether the review is of a response that changed nothing; shows the notice saying so. */
    declare public isUnchanged: boolean;
    /** The run's cost line ("model · tokens · price"), shown in the review actions row. */
    declare public usageText: string;
    /** Whether the host gave the prompt row a setting to offer; without one it is not drawn. */
    declare public hasPicker: boolean;

    /** The (sanitized) response HTML, kept for re-rendering when the view mode flips. */
    private _resultHtml = "";
    /** The (sanitized) diff HTML of the review phase, when the host provided one. */
    private _diffHtml = "";

    public readonly promptInputView: InputTextView;
    public readonly sendButtonView: ButtonView;
    public readonly resultToggleView: ButtonView;
    public readonly changesToggleView: ButtonView;
    public readonly previewView: AiPreviewView;
    public readonly stopButtonView: ButtonView;
    public readonly replaceButtonView: ButtonView;
    public readonly insertBelowButtonView: ButtonView;
    public readonly tryAgainButtonView: ButtonView;
    /**
     * The setting a run answers to, offered beside the prompt — Trilium hangs the model here. Its
     * list is bound to {@link _pickerItems}, so replacing the picker re-renders it in place.
     */
    public readonly pickerView: DropdownView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly _focusables = new ViewCollection<FocusableView>();
    private readonly _onResultRendered?: (preview: HTMLElement) => void;
    /** What the picker offers. Bound to its list, so refilling it redraws the list in place. */
    private readonly _pickerItems = new Collection<ListDropdownItemDefinition>();
    /** The choices behind those rows, in the order the rows carry as their index. */
    private _pickerChoices: AiQuickActionFooter[] = [];

    constructor(locale: Locale, { onResultRendered }: AiAssistantFormOptions = {}) {
        super(locale);

        const t = locale.t;
        this._onResultRendered = onResultRendered;

        this.set("phase", "prompt");
        this.set("query", "");
        this.set("errorMessage", "");
        this.set("viewMode", "result");
        this.set("hasDiff", false);
        this.set("isUnchanged", false);
        this.set("usageText", "");
        // Nothing to answer to until the host says otherwise, so the row starts without it.
        this.set("hasPicker", false);

        // Re-render the preview from the stored contents whenever the toggle flips.
        this.on("change:viewMode", () => this._renderPreview());

        this.resultToggleView = this._createViewModeButton(locale, t("Result"), "result");
        this.changesToggleView = this._createViewModeButton(locale, t("Changes"), "changes");
        this.promptInputView = this._createPromptInput(locale);
        this.sendButtonView = this._createSendButton(locale);
        this.pickerView = this._createPicker(locale);
        this.previewView = new AiPreviewView(locale);
        // A response that changed nothing is the text the user is already looking at, so the
        // placeholder stands in its place rather than sitting under a copy of it.
        this.previewView.bind("isVisible").to(
            this, "phase",
            this, "isUnchanged",
            (phase, isUnchanged) => phase !== "prompt" && !isUnchanged
        );

        // Takes Send's place in the prompt row while a run is in flight: the control that acts on
        // the run belongs where the eye already is, and one icon replacing another keeps the row
        // from resizing as the phase turns over.
        this.stopButtonView = this._createActionButton(locale, t("Stop"), "streaming", "stop", "isVisible");
        this.stopButtonView.set({ icon: IconStop, withText: false, tooltip: true });
        this.stopButtonView.class = "ck-button-action ck-ai-assistant-form__icon-action";
        this.replaceButtonView = this._createActionButton(locale, t("Replace"), "review", "replace");
        this.replaceButtonView.class = "ck-button-action";
        this.insertBelowButtonView = this._createActionButton(locale, t("Insert below"), "review", "insertBelow");
        // Icon-only, and sitting over the preview rather than among the commit actions: re-running
        // is about the response on screen, not about what to do with it.
        this.tryAgainButtonView = new ButtonView(locale);
        this.tryAgainButtonView.set({
            label: t("Try again"),
            icon: IconRefresh,
            tooltip: true,
            class: "ck-ai-assistant-form__icon-action"
        });
        // On show throughout, for the same reason the view modes are: the strip has to hold its
        // place so a finished run does not move the rows beneath it.
        this.tryAgainButtonView.bind("isEnabled").to(this, "phase", (phase) => phase === "review");
        this.tryAgainButtonView.on("execute", () => this.fire("tryAgain"));

        const bind = this.bindTemplate;

        this.setTemplate({
            tag: "form",
            attributes: {
                class: [
                    "ck",
                    "ck-ai-assistant-form",
                    // Lets the stylesheet stand a placeholder in for the response that has been
                    // asked for and not yet begun to arrive.
                    bind.if("phase", "ck-ai-assistant-form_streaming", (phase) => phase === "streaming")
                ],
                tabindex: "-1"
            },
            children: [
                {
                    // The preview's own strip: the Result/Changes toggle on the left, "Try again"
                    // pushed to the right. The feature's title belongs to the dialog's header.
                    //
                    // Absent until a run is asked for — before that the form is a prompt and
                    // nothing else — and present unchanged from then on, so the only thing that
                    // moves once the response is on its way is the preview filling up.
                    tag: "div",
                    attributes: {
                        class: [
                            "ck",
                            "ck-ai-assistant-form__preview-toolbar",
                            bind.if("phase", "ck-hidden", (phase) => phase === "prompt")
                        ]
                    },
                    children: [
                        {
                            // The two modes are one choice, so they share a container the host can
                            // draw as a group — Trilium renders it as its segmented track.
                            tag: "div",
                            attributes: { class: ["ck", "ck-ai-assistant-form__viewmodes"] },
                            children: [this.resultToggleView, this.changesToggleView]
                        },
                        {
                            // What the run cost and the way to ask for another are both about the
                            // response on show, so they end its strip together. A container of
                            // their own, rather than a margin on each, keeps them to the end
                            // whether or not the provider reported any usage.
                            tag: "div",
                            attributes: { class: ["ck", "ck-ai-assistant-form__preview-toolbar-end"] },
                            children: [
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
                                },
                                this.tryAgainButtonView
                            ]
                        }
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
                    // What the preview would have shown is the text the run was given, word for
                    // word, and a "Changes" view of it would be a diff with no marks in it — which
                    // reads as a diff that failed. So the answer is given as an answer.
                    tag: "div",
                    attributes: {
                        class: [
                            "ck",
                            "ck-ai-assistant-form__empty",
                            bind.if("isUnchanged", "ck-hidden", (isUnchanged) => !isUnchanged)
                        ]
                    },
                    children: [
                        createIcon(IconCheck),
                        { text: t("Looks good already — nothing to change.") }
                    ]
                },
                {
                    tag: "div",
                    // One island, as the chat's composer is: what is being written on top, and
                    // underneath it what the writing will be sent to and the button that sends it.
                    // The border and the focus ring belong to the island, not to the field inside.
                    attributes: { class: ["ck", "ck-ai-assistant-form__prompt-row"] },
                    children: [
                        this.promptInputView,
                        {
                            tag: "div",
                            attributes: { class: ["ck", "ck-ai-assistant-form__prompt-actions"] },
                            // Send and Stop share the slot at the end of the row; the phase decides
                            // which of the two is on show.
                            children: [
                                {
                                    tag: "div",
                                    attributes: {
                                        class: [
                                            "ck",
                                            "ck-ai-assistant-form__picker",
                                            bind.if("hasPicker", "ck-hidden", (hasPicker) => !hasPicker)
                                        ]
                                    },
                                    children: [this.pickerView]
                                },
                                this.sendButtonView,
                                this.stopButtonView
                            ]
                        }
                    ]
                },
                {
                    // Reserved from the moment a run is asked for, its buttons inert until there is
                    // something to commit: appearing at the end of a run would drop the dialog's
                    // last row in under the reader mid-read.
                    tag: "div",
                    attributes: {
                        class: [
                            "ck",
                            "ck-ai-assistant-form__actions",
                            bind.if("phase", "ck-hidden", (phase) => phase === "prompt")
                        ]
                    },
                    children: [
                        // The row is pushed to the end, so "Replace" comes last to land where the
                        // eye finishes and the primary action is expected.
                        this.insertBelowButtonView,
                        this.replaceButtonView
                    ]
                }
            ]
        });

        // Kept for its wiring rather than its handle: constructing it is what binds Tab and
        // Shift+Tab to the focusables, and nothing here drives the cycle by hand.
        new FocusCycler({
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

        // In DOM order, so Tab walks the form the way it reads.
        const focusables = [
            this.resultToggleView,
            this.changesToggleView,
            this.tryAgainButtonView,
            this.promptInputView,
            this.pickerView.buttonView,
            this.sendButtonView,
            this.stopButtonView,
            this.insertBelowButtonView,
            this.replaceButtonView
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
        this.isUnchanged = false;
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
        this.isUnchanged = false;
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
     * Leaves the streaming phase. With content the form enters review, on the view the caller asks
     * for (the "Changes" view by default, whenever there is a diff), while a run that produced
     * nothing falls back to the prompt phase, showing `errorMessage` when the run failed.
     */
    public enterReview({
        hasContent, diffHtml, errorMessage = "", usageText = "", viewMode, isUnchanged = false
    }: AiReviewOptions): void {
        this.phase = hasContent ? "review" : "prompt";
        this.isUnchanged = hasContent && isUnchanged;
        this.errorMessage = errorMessage;
        this._diffHtml = diffHtml ?? "";
        this.hasDiff = hasContent && !!this._diffHtml;
        this.viewMode = this.hasDiff ? (viewMode ?? "changes") : "result";
        this.usageText = hasContent ? usageText : "";
        this._renderPreview();
    }

    /**
     * Lands on the prompt, which is the one thing there is to do on arrival in every phase — the
     * rest of the form is a response to read or an action to take on one. Straight to the field
     * rather than cycling to the first focusable, so where focus goes does not depend on which
     * rows the current phase happens to be showing.
     */
    public focus(): void {
        this.promptInputView.focus();
    }

    /** Shows whichever stored content the current view mode selects. */
    private _renderPreview(): void {
        const isDiff = this.viewMode === "changes" && !!this._diffHtml;
        this.previewView.setContent(isDiff ? this._diffHtml : this._resultHtml);

        // Only the finished result is handed on: half a diagram cannot be parsed, so rendering
        // each streamed tick would flash a parse error where the diagram is about to be, and the
        // "Changes" view is two responses interleaved — its code blocks are not source any more.
        const preview = this.previewView.element;
        if (preview && this.phase === "review" && !isDiff) {
            this._onResultRendered?.(preview);
        }
    }

    /** One half of the Result/Changes toggle, visible only when a review has a diff to offer. */
    private _createViewModeButton(locale: Locale, label: string, mode: AiReviewView) {
        const button = new ButtonView(locale);
        button.set({ label, withText: true, isToggleable: true, class: "ck-ai-assistant-form__viewmode" });
        button.bind("isOn").to(this, "viewMode", (viewMode) => viewMode === mode);
        // Enabled rather than shown: a strip that only appears once a run finishes would shift
        // everything under it at the moment the response lands.
        button.bind("isEnabled").to(
            this, "phase",
            this, "hasDiff",
            (phase, hasDiff) => phase === "review" && hasDiff
        );
        button.on("execute", () => {
            this.viewMode = mode;
        });
        return button;
    }

    private _createPromptInput(locale: Locale) {
        const t = locale.t;
        const input = new InputTextView(locale);

        // A placeholder is not a label, and the field no longer has a visible one, so the
        // accessible name has to be given outright.
        input.set({ ariaLabel: t("Ask AI to…") });

        // The field is read-only mid-run, so an instruction to type would be inviting something
        // that cannot happen; it says what is happening instead.
        input.bind("placeholder").to(this, "phase", (phase) => (phase === "streaming"
            ? t("Working…")
            : t("Describe a change then press Enter")));

        // Two-way: the field drives `query`, and reset() drives the field.
        input.bind("value").to(this, "query");
        input.on("input", () => {
            /* v8 ignore next -- the input event can only come from a rendered element */
            this.query = input.element?.value ?? "";
        });
        // An input has no `isEnabled`; read-only rather than disabled also leaves the prompt
        // selectable while the response it asked for streams in.
        input.bind("isReadOnly").to(this, "phase", (phase) => phase === "streaming");

        return input;
    }

    /**
     * Replaces what the picker offers, or takes it off the row entirely when the host has nothing
     * to offer. Rebuilding the definitions is enough: the list is bound to them.
     *
     * A row's children become the choices, grouped by the {@link AiQuickActionFooter.heading} they
     * open a block with — CKEditor's own list groups here, rather than the headings the menu has to
     * insert by hand, because a plain list can express a group and a nested menu definition cannot.
     */
    public setPicker(picker: AiQuickActionFooter | null): void {
        this._pickerItems.clear();
        this._pickerChoices = [];

        const choices = picker?.children ?? [];
        this.hasPicker = choices.length > 0;
        if (!this.hasPicker) {
            return;
        }

        let group: { type: "group"; label: string; items: Collection<ListDropdownButtonDefinition> } | null = null;
        for (const choice of choices) {
            const definition = this._createPickerChoice(choice);

            if (choice.heading) {
                group = { type: "group", label: choice.heading, items: new Collection() };
                this._pickerItems.add(group);
            }

            // Everything up to the first heading, and everything at all when there are none, sits
            // at the top level — a group is opened by the row that names it, not assumed around it.
            (group?.items ?? this._pickerItems).add(definition);
        }

        // The button says what is in force rather than repeating the picker's own name: the row it
        // sits in is already about the run, and the name of the setting is what the tooltip is for.
        const current = choices.find((choice) => choice.isCurrent);
        this.pickerView.buttonView.set({ label: current?.label ?? picker?.label, tooltip: picker?.label });
    }

    private _createPicker(locale: Locale): DropdownView {
        const dropdown = createDropdown(locale);

        dropdown.buttonView.set({ withText: true, tooltip: true });
        dropdown.class = "ck-ai-assistant-form__picker-dropdown";
        // Nothing to pick between mid-run: the model a response is streaming from is settled.
        dropdown.bind("isEnabled").to(this, "phase", (phase) => phase !== "streaming");
        addListToDropdown(dropdown, this._pickerItems, { role: "menu" });

        // A list definition is a bag of *properties*, bound onto the button CKEditor builds from it
        // — it is not something that can be listened to. So the row carries its index, the way
        // CKEditor's own dropdowns carry a command name, and the choice is looked up on execute.
        dropdown.on("execute", (evt) => {
            dropdown.isOpen = false;
            const { choiceIndex } = evt.source as { choiceIndex?: number };
            if (choiceIndex !== undefined) {
                this._pickerChoices[choiceIndex]?.run?.();
            }
        });

        return dropdown;
    }

    /** One choice, as a checkable list row — the check column and its alignment are CKEditor's. */
    private _createPickerChoice(choice: AiQuickActionFooter): ListDropdownButtonDefinition {
        return {
            type: "button",
            model: new UIModel({
                label: choice.label,
                withText: true,
                role: "menuitemcheckbox",
                isOn: !!choice.isCurrent,
                choiceIndex: this._pickerChoices.push(choice) - 1
            })
        };
    }

    private _createSendButton(locale: Locale) {
        const button = new ButtonView(locale);
        button.set({
            label: locale.t("Send"),
            icon: IconArrowUp,
            tooltip: true,
            type: "submit",
            class: "ck-button-action ck-ai-assistant-form__icon-action"
        });
        button.bind("isEnabled").to(
            this, "query",
            this, "phase",
            (query, phase) => !!String(query).trim() && phase !== "streaming"
        );
        // Stands aside for "Stop", which takes over the slot for the length of a run.
        button.bind("isVisible").to(this, "phase", (phase) => phase !== "streaming");
        return button;
    }

    /** A text action button that is only visible in the given phase and re-emits `eventName`. */
    /**
     * A text button that fires `eventName` when the form reaches `phase`. Gated by enablement, so
     * the row it sits in keeps its height across the phase it belongs to — `isVisible` is for a
     * button that shares its slot with another, which only "Stop" does.
     */
    private _createActionButton(
        locale: Locale,
        label: string,
        phase: AiAssistantFormPhase,
        eventName: string,
        gate: "isVisible" | "isEnabled" = "isEnabled"
    ) {
        const button = new ButtonView(locale);
        button.set({ label, withText: true });
        button.bind(gate).to(this, "phase", (currentPhase) => currentPhase === phase);
        button.on("execute", () => this.fire(eventName));
        return button;
    }
}

/** A standalone glyph for a template. `IconView` takes its SVG through a property, not a call. */
function createIcon(content: string): IconView {
    const icon = new IconView();
    icon.content = content;
    return icon;
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
                    // Exempt the preview subtree from CKEditor's UI reset. Balloons and dialogs
                    // alike are mounted into `editor.ui.view.body`, whose wrapper carries
                    // `.ck-reset_all` — which otherwise forces `white-space: nowrap` (plus zeroed
                    // margins and the UI font) onto the content, making every paragraph one long
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
