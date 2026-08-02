import {
    ButtonView,
    clickOutsideHandler,
    ContextualBalloon,
    Plugin,
    type ModelNode,
    type ModelRange
} from "ckeditor5";

import { translate } from "../translate.js";
import type { AiCompletionUsage } from "./ai_assistant_config.js";
import AiAssistantEditing, { AI_TARGET_MARKER } from "./ai_assistant_editing.js";
import AiAssistantFormView, { type AiQuickActionEvent } from "./ai_assistant_form.js";
import { sanitizeAiHtml, stripMarkdownFences } from "./ai_html.js";
import aiIcon from "./theme/icons/ai.svg?raw";
import "./theme/ai_assistant.css";

/**
 * SSE chunks can arrive per-token; re-rendering the whole preview for each one buys nothing
 * visually and burns CPU re-parsing the growing prefix. One render per interval is smooth enough.
 */
const RENDER_THROTTLE_MS = 80;

/**
 * The AI assistant's UI and orchestration: the toolbar button, the balloon form, and the
 * stream-preview-commit lifecycle.
 *
 * The core design decision is that **the stream never touches the document**. The response
 * streams into the form's detached preview; the note is modified exactly once, when the user
 * commits with Replace or Insert below — a single `model.change()`, so a single undo step.
 */
export default class AiAssistantUI extends Plugin {

    static get requires() {
        return [AiAssistantEditing, ContextualBalloon] as const;
    }

    static get pluginName() {
        return "AiAssistantUI" as const;
    }

    private _formView: AiAssistantFormView | null = null;
    private _abortController: AbortController | null = null;
    private _streaming = false;

    /** The cumulative response of the current/last run, after fence-stripping. */
    private _cumulative = "";
    /** The HTML the next query will run against: the selection, then each committed-to response. */
    private _context = "";
    /** The context of the last run, restored by "Try again" so a retry does not chain on itself. */
    private _previousContext = "";
    private _lastQuery = "";

    public init(): void {
        const editor = this.editor;

        editor.ui.componentFactory.add("aiAssistant", (locale) => {
            const command = editor.commands.get("aiAssistant");
            const buttonView = new ButtonView(locale);

            buttonView.set({
                label: translate(editor, "ai_assistant.title", "AI assistant"),
                icon: aiIcon,
                tooltip: true
            });

            /* v8 ignore next -- AiAssistantEditing always registers the command (it is required by this plugin) */
            if (command) {
                buttonView.bind("isEnabled").to(command, "isEnabled");
            }

            this.listenTo(buttonView, "execute", () => editor.execute("aiAssistant"));
            return buttonView;
        });
    }

    public override destroy(): void {
        super.destroy();
        this._abortController?.abort();
        this._formView?.destroy();
    }

    /** Opens the balloon on the current selection. Invoked by the `aiAssistant` command. */
    public show(): void {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this._getForm();

        if (balloon.hasView(form)) {
            form.focus();
            return;
        }

        // Capture the context and pin the target before focus moves into the balloon and the
        // document selection stops being trustworthy.
        const model = editor.model;
        const selection = model.document.selection;
        this._context = selection.isCollapsed
            ? ""
            : editor.data.stringify(model.getSelectedContent(selection));
        this._previousContext = this._context;
        this._cumulative = "";
        form.hasContext = !!this._context;

        const range = selection.getFirstRange();
        /* v8 ignore next -- the document selection always has at least one range */
        if (range) {
            model.change((writer) => {
                writer.addMarker(AI_TARGET_MARKER, { range, usingOperation: false, affectsData: false });
            });
        }

        form.reset();
        balloon.add({ view: form, position: this._getBalloonPosition() });
        form.focus();
    }

    private _getForm(): AiAssistantFormView {
        if (this._formView) {
            return this._formView;
        }

        const editor = this.editor;
        const form = new AiAssistantFormView(
            editor.locale,
            (key, fallback) => translate(editor, key, fallback),
            editor.config.get("aiAssistant")?.quickActions ?? []
        );
        this._formView = form;

        form.on("submit", () => {
            const query = form.query.trim();
            if (query) {
                form.query = "";
                void this._run(query);
            }
        });
        form.on<AiQuickActionEvent>("quickAction", (_evt, action) => {
            void this._run(action.prompt);
        });
        form.on("stop", () => this._abortController?.abort());
        form.on("replace", () => this._commit("replace"));
        form.on("insertBelow", () => this._commit("insertBelow"));
        form.on("tryAgain", () => {
            // Retry against what the last run saw, not against its own output.
            this._context = this._previousContext;
            void this._run(this._lastQuery);
        });

        // The Result and Changes views usually differ in height; keep the balloon anchored.
        this.listenTo(form, "change:viewMode", () => {
            const balloon = this.editor.plugins.get(ContextualBalloon);
            if (balloon.visibleView === form) {
                balloon.updatePosition();
            }
        });

        // Esc always dismisses. A click outside only dismisses an idle, empty form — mid-stream or
        // with a response on screen it would silently throw the result away.
        form.keystrokes.set("Esc", (_data, cancel) => {
            this._hide();
            cancel();
        });
        clickOutsideHandler({
            emitter: form,
            activator: () => this.editor.plugins.get(ContextualBalloon).hasView(form),
            contextElements: () => [this.editor.plugins.get(ContextualBalloon).view.element as HTMLElement],
            callback: () => {
                if (form.phase === "prompt" && !this._cumulative) {
                    this._hide();
                }
            }
        });

        return form;
    }

    private async _run(query: string): Promise<void> {
        const editor = this.editor;
        const stream = editor.config.get("aiAssistant")?.stream;
        const form = this._getForm();
        /* v8 ignore next -- the command is disabled without a stream, and the form blocks submits while streaming */
        if (!stream || this._streaming) {
            return;
        }

        this._previousContext = this._context;
        this._lastQuery = query;
        this._streaming = true;
        this._cumulative = "";
        form.beginStreaming();

        const abortController = new AbortController();
        this._abortController = abortController;

        const balloon = editor.plugins.get(ContextualBalloon);
        const render = (html: string) => {
            form.setPreview(sanitizeAiHtml(html));
            // The preview grows as it fills; keep the balloon anchored rather than overflowing.
            if (balloon.visibleView === form) {
                balloon.updatePosition();
            }
        };

        let renderTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingHtml: string | null = null;
        const onData = (cumulative: string) => {
            const cleaned = stripMarkdownFences(cumulative);
            this._cumulative = cleaned;
            if (renderTimer) {
                pendingHtml = cleaned;
                return;
            }
            render(cleaned);
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
            usage = (await stream({ query, context: this._context }, onData, abortController.signal)) ?? null;
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
            this._streaming = false;
            this._abortController = null;
        }

        if (this._cumulative) {
            // Follow-up queries chain on the response ("now make it shorter"), premium-style.
            this._context = this._cumulative;
        }
        // A response counts as content, so content-requiring quick actions unlock for chaining.
        form.hasContext = !!this._context;
        form.enterReview(!!this._cumulative, this._buildDiff(), errorMessage, this._formatUsage(usage));
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
            parts.push(`${usage.totalTokens.toLocaleString()} ${translate(this.editor, "ai_assistant.tokens", "tokens")}`);
        }
        if (usage.cost != null) {
            // A single completion usually costs well under a cent; two decimals would show $0.00.
            parts.push(`~$${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}`);
        }
        return parts.join(" · ");
    }

    /**
     * The "Changes" view of the review: the finished response diffed against the context the run
     * saw (`_previousContext` — so a follow-up query diffs against the response it refined, not
     * the original selection). Only computed once the stream is complete; diffing a partial
     * response would render everything not yet streamed as deleted. Null when the host provides
     * no diff renderer or there is nothing to diff against (generate-from-scratch).
     */
    private _buildDiff(): string | null {
        const diff = this.editor.config.get("aiAssistant")?.diff;
        if (!diff || !this._cumulative || !this._previousContext) {
            return null;
        }
        try {
            return sanitizeAiHtml(diff(this._previousContext, this._cumulative));
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

        const modelFragment = editor.data.toModel(editor.data.processor.toView(sanitizeAiHtml(html)));
        const model = editor.model;

        model.change((writer) => {
            const target = this._getTargetRange();
            if (!target) {
                return;
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

    private _hide(): void {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this._formView;

        this._abortController?.abort();
        this._cumulative = "";

        if (editor.model.markers.has(AI_TARGET_MARKER)) {
            editor.model.change((writer) => writer.removeMarker(AI_TARGET_MARKER));
        }
        if (form && balloon.hasView(form)) {
            balloon.remove(form);
        }
        form?.reset();
        editor.editing.view.focus();
    }

    private _getBalloonPosition() {
        const editor = this.editor;
        return {
            target: () => {
                const modelRange = this._getTargetRange();
                if (modelRange) {
                    const viewRange = editor.editing.mapper.toViewRange(modelRange);
                    return editor.editing.view.domConverter.viewRangeToDom(viewRange);
                }
                /* v8 ignore next -- there is always either a marker or a document selection range */
                return editor.ui.getEditableElement() as HTMLElement;
            }
        };
    }
}
