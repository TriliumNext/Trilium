import { Locale } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import AiAssistantFormView from "./ai_assistant_form.js";

let form: AiAssistantFormView;

function makeForm(): AiAssistantFormView {
    form = new AiAssistantFormView(new Locale());
    form.render();
    return form;
}

function previewHtml(): string {
    return form.previewView.element?.innerHTML ?? "";
}

afterEach(() => {
    form?.destroy();
});

describe("AiAssistantFormView", () => {
    /** Whether a row of the form is on show, by the class the template hides it with. */
    function rowShown(selector: string): boolean {
        const row = form.element?.querySelector(selector);
        return !!row && !row.classList.contains("ck-hidden");
    }

    it("starts as a prompt and nothing else", () => {
        const form = makeForm();
        expect(form.phase).toBe("prompt");

        // Nothing to review yet, so the review's rows are not there to be reviewed with.
        expect(rowShown(".ck-ai-assistant-form__preview-toolbar")).toBe(false);
        expect(rowShown(".ck-ai-assistant-form__actions")).toBe(false);
        expect(rowShown(".ck-ai-assistant-form__prompt-row")).toBe(true);

        // Without the reset exemption, the body wrapper's `.ck-reset_all` nowraps every paragraph.
        expect(form.previewView.element?.classList.contains("ck-reset_all-excluded")).toBe(true);
    });

    it("settles its layout when the run is asked for, not when it lands", () => {
        const form = makeForm();
        form.beginStreaming();

        // Everything the review needs arrives at once, with the keystroke that asked for it, and
        // is inert until there is something to use it on. Nothing may appear later: the wait for
        // the first chunk, and the moment it lands, both have to leave the rows where they are.
        expect(rowShown(".ck-ai-assistant-form__preview-toolbar")).toBe(true);
        expect(rowShown(".ck-ai-assistant-form__actions")).toBe(true);

        const reviewViews = [
            form.resultToggleView,
            form.changesToggleView,
            form.tryAgainButtonView,
            form.insertBelowButtonView,
            form.replaceButtonView
        ];
        for (const view of reviewViews) {
            expect(view.isVisible).toBe(true);
            expect(view.isEnabled).toBe(false);
        }

        form.setPreview("<p>new</p>");
        form.enterReview({ hasContent: true });

        expect(rowShown(".ck-ai-assistant-form__preview-toolbar")).toBe(true);
        expect(rowShown(".ck-ai-assistant-form__actions")).toBe(true);
        for (const view of reviewViews) {
            expect(view.isVisible).toBe(true);
        }
        expect(form.insertBelowButtonView.isEnabled).toBe(true);
        expect(form.replaceButtonView.isEnabled).toBe(true);
    });

    it("streams into the preview and always shows the raw result while streaming", () => {
        const form = makeForm();
        form.beginStreaming();
        expect(form.phase).toBe("streaming");
        expect(form.viewMode).toBe("result");

        form.setPreview("<p>partial</p>");
        expect(previewHtml()).toBe("<p>partial</p>");
    });

    it("defaults the review to the Changes view when a diff is available and toggles back", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview({ hasContent: true, diffHtml: "<p><del class=\"diffdel\">old</del><ins class=\"diffins\">new</ins></p>" });

        expect(form.phase).toBe("review");
        expect(form.hasDiff).toBe(true);
        expect(form.viewMode).toBe("changes");
        expect(previewHtml()).toContain("diffins");
        expect(form.resultToggleView.isEnabled).toBe(true);
        expect(form.changesToggleView.isOn).toBe(true);

        // The two modes are one choice, and share a container so the host can draw them as a group.
        expect(form.resultToggleView.element?.parentElement)
            .toBe(form.changesToggleView.element?.parentElement);
        expect(form.resultToggleView.element?.closest(".ck-ai-assistant-form__viewmodes")).not.toBeNull();

        form.resultToggleView.fire("execute");
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("<p>new</p>");
        expect(form.resultToggleView.isOn).toBe(true);

        form.changesToggleView.fire("execute");
        expect(previewHtml()).toContain("diffdel");
    });

    it("reviews without a diff in the Result view with the toggle hidden", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>generated</p>");
        form.enterReview({ hasContent: true });

        expect(form.phase).toBe("review");
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("<p>generated</p>");
        // Nothing to diff against, so the choice stays inert while re-running does not.
        expect(form.changesToggleView.isEnabled).toBe(false);
        expect(form.tryAgainButtonView.isEnabled).toBe(true);
    });

    it("stands a message in for a response that changed nothing", () => {
        const form = makeForm();
        const empty = () => form.element?.querySelector(".ck-ai-assistant-form__empty");

        expect(empty()?.classList.contains("ck-hidden")).toBe(true);

        form.beginStreaming();
        form.setPreview("<p>already perfect</p>");
        form.enterReview({ hasContent: true, isUnchanged: true });

        expect(form.isUnchanged).toBe(true);
        expect(empty()?.classList.contains("ck-hidden")).toBe(false);
        expect(empty()?.textContent).toContain("nothing to change");
        // The response is the text the user is already looking at, so it takes the place of the
        // preview rather than being shown above the message saying it changed nothing.
        expect(form.previewView.isVisible).toBe(false);
        // Nothing changed, so there is no second view of it to offer either.
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");

        // The next run starts over rather than carrying the message into it.
        form.beginStreaming();
        expect(empty()?.classList.contains("ck-hidden")).toBe(true);
        expect(form.previewView.isVisible).toBe(true);
    });

    it("opens the review on the view the caller names, keeping the other one click away", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>bonjour</p>");
        // What a translation's review asks for: its diff is two unrelated texts, not an edit.
        form.enterReview({ hasContent: true, diffHtml: "<p>diff</p>", viewMode: "result" });

        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("<p>bonjour</p>");
        expect(form.hasDiff).toBe(true);
        expect(form.changesToggleView.isEnabled).toBe(true);

        form.changesToggleView.fire("execute");
        expect(previewHtml()).toBe("<p>diff</p>");
    });

    // `document.activeElement` cannot be asserted here — the headless window holds no focus, so
    // even a direct `element.focus()` leaves it on `<body>`. Delegation is the testable part.
    it("puts focus in the prompt whatever phase it is asked in", () => {
        const form = makeForm();
        const focusPrompt = vi.spyOn(form.promptInputView, "focus");

        form.focus();
        expect(focusPrompt).toHaveBeenCalledTimes(1);

        // Not the first focusable in the list, and which rows are on show varies by phase, so the
        // landing spot must not be arrived at by cycling.
        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview({ hasContent: true });
        form.focus();
        expect(focusPrompt).toHaveBeenCalledTimes(2);
    });

    it("takes the prompt through a placeholder rather than a label, and sends with an icon", () => {
        const form = makeForm();

        expect(form.promptInputView.placeholder).toBe("Describe a change then press Enter");
        // A placeholder is not an accessible name, so the field carries one of its own.
        expect(form.promptInputView.ariaLabel).toBe("Ask AI to…");
        expect(form.element?.querySelector("label")).toBeNull();

        expect(form.sendButtonView.icon).toContain("<svg");
        expect(form.sendButtonView.withText).toBeFalsy();
        expect(form.sendButtonView.label).toBe("Send");
        expect(form.sendButtonView.tooltip).toBe(true);

        // Nothing to send until something is typed.
        expect(form.sendButtonView.isEnabled).toBe(false);
        form.query = "make it shorter";
        expect(form.sendButtonView.isEnabled).toBe(true);
    });

    it("hands the prompt row over to 'Stop' for the length of a run", () => {
        const form = makeForm();

        expect(form.sendButtonView.isVisible).toBe(true);
        expect(form.stopButtonView.isVisible).toBe(false);
        // Both are icons in the same slot, so the row keeps its size as the phase turns over.
        expect(form.stopButtonView.icon).toContain("<svg");
        expect(form.stopButtonView.withText).toBe(false);
        expect(form.stopButtonView.label).toBe("Stop");
        expect(form.stopButtonView.element?.closest(".ck-ai-assistant-form__prompt-row")).not.toBeNull();

        form.beginStreaming();
        expect(form.sendButtonView.isVisible).toBe(false);
        expect(form.stopButtonView.isVisible).toBe(true);

        // Read-only rather than disabled, so the prompt stays selectable, and the placeholder says
        // what is happening instead of inviting input that cannot land.
        expect(form.promptInputView.isReadOnly).toBe(true);
        expect(form.promptInputView.placeholder).toBe("Working…");

        // An empty preview stands in for the response until the first chunk arrives, so the dialog
        // does not read as idle.
        expect(form.element?.classList.contains("ck-ai-assistant-form_streaming")).toBe(true);
        expect(previewHtml()).toBe("");
    });

    it("offers 'Try again' as an icon in the preview's strip rather than among the commit actions", () => {
        const form = makeForm();
        const button = form.tryAgainButtonView;

        expect(button.isEnabled).toBe(false);
        expect(button.withText).toBe(false);
        expect(button.icon).toContain("<svg");
        // Icon-only: the label has to survive as the tooltip and the accessible name.
        expect(button.label).toBe("Try again");
        expect(button.tooltip).toBe(true);

        expect(button.element?.closest(".ck-ai-assistant-form__preview-toolbar")).not.toBeNull();
        expect(button.element?.closest(".ck-ai-assistant-form__actions")).toBeNull();

        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview({ hasContent: true });
        expect(button.isEnabled).toBe(true);
    });

    it("shows the usage line only for a review that has one, and clears it on the next run", () => {
        const form = makeForm();
        const usageEl = form.element?.querySelector(".ck-ai-assistant-form__usage");

        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview({ hasContent: true, usageText: "some-model · 1,234 tokens · ~$0.0042" });
        expect(form.usageText).toBe("some-model · 1,234 tokens · ~$0.0042");
        expect(usageEl?.textContent).toBe("some-model · 1,234 tokens · ~$0.0042");
        expect(usageEl?.classList.contains("ck-hidden")).toBe(false);

        // A failed follow-up run must not keep advertising the previous run's cost.
        form.beginStreaming();
        expect(form.usageText).toBe("");
        expect(usageEl?.classList.contains("ck-hidden")).toBe(true);
        form.enterReview({ hasContent: false, errorMessage: "boom", usageText: "ignored — no content to review" });
        expect(form.usageText).toBe("");
    });

    it("falls back to the prompt phase with the error when a run produced nothing", () => {
        const form = makeForm();
        form.beginStreaming();
        form.enterReview({ hasContent: false, errorMessage: "provider unreachable" });

        expect(form.phase).toBe("prompt");
        expect(form.errorMessage).toBe("provider unreachable");
    });

    // The hook the host renders Mermaid diagrams through: only a finished result can be, so it is
    // offered the preview at the one point at which what it holds is a whole response.
    it("hands the preview to the host once it holds a finished result, and not before", () => {
        const onResultRendered = vi.fn();
        form = new AiAssistantFormView(new Locale(), { onResultRendered });
        form.render();

        form.beginStreaming();
        form.setPreview("<p>par</p>");
        form.setPreview("<p>partial</p>");
        expect(onResultRendered).not.toHaveBeenCalled();

        // A review opening on the diff shows two responses at once, which is nobody's content.
        form.enterReview({ hasContent: true, diffHtml: "<p><ins>partial</ins></p>" });
        expect(onResultRendered).not.toHaveBeenCalled();

        form.resultToggleView.fire("execute");
        expect(onResultRendered).toHaveBeenCalledWith(form.previewView.element);
    });

    it("reset clears the stored contents and view-mode state", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview({ hasContent: true, diffHtml: "<p>diff</p>" });

        form.reset();
        expect(form.phase).toBe("prompt");
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("");

        // A later streaming run must not resurrect the previous run's diff.
        form.beginStreaming();
        form.enterReview({ hasContent: true });
        expect(previewHtml()).toBe("");
    });

    // Following the stream is only wanted while the reader is at the end of it. Someone who
    // scrolled up to re-read something is reading, and yanking them back down loses their place.
    it("follows the stream only while the preview is scrolled to the bottom", () => {
        const form = makeForm();
        const element = form.element;
        const preview = form.previewView.element;
        if (!element || !preview) {
            throw new Error("the form did not render");
        }

        // Layout is what the check reads, so the form has to be on the page and the preview has to
        // be smaller than what it holds.
        document.body.appendChild(element);
        preview.style.height = "20px";
        preview.style.overflowY = "auto";

        try {
            form.beginStreaming();
            form.setPreview("<p>line</p>".repeat(40));
            expect(preview.scrollTop).toBeGreaterThan(0);

            preview.scrollTop = 0;
            form.setPreview("<p>line</p>".repeat(80));
            expect(preview.scrollTop).toBe(0);
        } finally {
            element.remove();
        }
    });

    // The form owns no behaviour of its own: each button says what was asked for and the plugin
    // decides what that means.
    it("announces each action from the button that carries it", () => {
        const form = makeForm();
        const fired: string[] = [];
        for (const event of [ "tryAgain", "replace", "insertBelow", "stop" ]) {
            form.on(event, () => fired.push(event));
        }

        form.tryAgainButtonView.fire("execute");
        form.replaceButtonView.fire("execute");
        form.insertBelowButtonView.fire("execute");
        form.stopButtonView.fire("execute");

        expect(fired).toEqual([ "tryAgain", "replace", "insertBelow", "stop" ]);
    });

    // Two-way: `reset()` drives the field through the binding, and typing drives `query` back.
    it("takes what is typed in the prompt as the query", () => {
        const form = makeForm();
        const input = form.promptInputView.element;
        if (!input) {
            throw new Error("the prompt input did not render");
        }

        input.value = "make it shorter";
        form.promptInputView.fire("input");

        expect(form.query).toBe("make it shorter");
    });

    describe("the model picker", () => {
        it("runs the choice a row stands for, and nothing at all for a row that stands for none", () => {
            const form = makeForm();
            const run = vi.fn();
            form.setPicker({
                label: "Model",
                children: [
                    { label: "Sonnet 5", isCurrent: true, run },
                    // A row with nothing to run: the picker still has to survive being told to.
                    { label: "Opus 5" }
                ]
            });

            // The list is only built on the first open, so the rows do not exist until then.
            form.pickerView.isOpen = true;
            const rows = [ ...(form.pickerView.listView?.items ?? []) ]
                .map((item) => (item as { children?: { first?: { fire(event: string): void } | null } }).children?.first);

            rows[1]?.fire("execute");
            expect(run).not.toHaveBeenCalled();

            rows[0]?.fire("execute");
            expect(run).toHaveBeenCalledTimes(1);
            // Picking closes the list: the setting is settled and the row already says so.
            expect(form.pickerView.isOpen).toBe(false);
        });

        // Only the rows carry an index. Anything else reaching the handler — the dropdown's own
        // button among them — is not a choice and must not be looked up as one.
        it("ignores an execute that came from something other than a row", () => {
            const form = makeForm();
            const run = vi.fn();
            form.setPicker({ label: "Model", children: [ { label: "Sonnet 5", run } ] });

            form.pickerView.fire("execute");

            expect(run).not.toHaveBeenCalled();
        });
    });
});
