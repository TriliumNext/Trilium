import { Locale } from "ckeditor5";
import { afterEach, describe, expect, it } from "vitest";

import type { AiQuickAction, AiQuickActionGroup } from "./ai_assistant_config.js";
import type { AiQuickActionEvent } from "./ai_assistant_form.js";
import AiAssistantFormView from "./ai_assistant_form.js";

let form: AiAssistantFormView;

function makeForm(quickActions: AiQuickActionGroup[] = []): AiAssistantFormView {
    form = new AiAssistantFormView(new Locale(), (_key, fallback) => fallback, quickActions);
    form.render();
    return form;
}

const SAMPLE_ACTIONS: AiQuickActionGroup[] = [{
    id: "edit",
    label: "Edit or review",
    actions: [
        { id: "fixTypos", label: "Fix typos", prompt: "Fix all mistakes." },
        { id: "generate", label: "Generate", prompt: "Write something.", requiresContent: false }
    ]
}];

/** The rendered quick-action item buttons, in definition order. */
function quickActionButtons(): HTMLButtonElement[] {
    form.quickActionsDropdownView.isOpen = true;
    const panel = form.quickActionsDropdownView.panelView.element;
    return Array.from(panel?.querySelectorAll("button") ?? []);
}

function previewHtml(): string {
    return form.previewView.element?.innerHTML ?? "";
}

afterEach(() => {
    form?.destroy();
});

describe("AiAssistantFormView", () => {
    it("starts in the prompt phase with the view-mode toggle hidden", () => {
        const form = makeForm();
        expect(form.phase).toBe("prompt");
        expect(form.resultToggleView.isVisible).toBe(false);
        expect(form.changesToggleView.isVisible).toBe(false);
        // Without the reset exemption, the balloon's `.ck-reset_all` nowraps every paragraph.
        expect(form.previewView.element?.classList.contains("ck-reset_all-excluded")).toBe(true);
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
        form.enterReview(true, "<p><del class=\"diffdel\">old</del><ins class=\"diffins\">new</ins></p>", "");

        expect(form.phase).toBe("review");
        expect(form.hasDiff).toBe(true);
        expect(form.viewMode).toBe("changes");
        expect(previewHtml()).toContain("diffins");
        expect(form.resultToggleView.isVisible).toBe(true);
        expect(form.changesToggleView.isOn).toBe(true);

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
        form.enterReview(true, null, "");

        expect(form.phase).toBe("review");
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("<p>generated</p>");
        expect(form.changesToggleView.isVisible).toBe(false);
    });

    it("shows the usage line only for a review that has one, and clears it on the next run", () => {
        const form = makeForm();
        const usageEl = form.element?.querySelector(".ck-ai-assistant-form__usage");

        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview(true, null, "", "some-model · 1,234 tokens · ~$0.0042");
        expect(form.usageText).toBe("some-model · 1,234 tokens · ~$0.0042");
        expect(usageEl?.textContent).toBe("some-model · 1,234 tokens · ~$0.0042");
        expect(usageEl?.classList.contains("ck-hidden")).toBe(false);

        // A failed follow-up run must not keep advertising the previous run's cost.
        form.beginStreaming();
        expect(form.usageText).toBe("");
        expect(usageEl?.classList.contains("ck-hidden")).toBe(true);
        form.enterReview(false, null, "boom", "ignored — no content to review");
        expect(form.usageText).toBe("");
    });

    it("falls back to the prompt phase with the error when a run produced nothing", () => {
        const form = makeForm();
        form.beginStreaming();
        form.enterReview(false, null, "provider unreachable");

        expect(form.phase).toBe("prompt");
        expect(form.errorMessage).toBe("provider unreachable");
    });

    it("hides the quick-actions dropdown when no actions are configured", () => {
        const form = makeForm();
        expect(form.quickActionsDropdownView.class).toBe("ck-hidden");
    });

    it("gates content-requiring quick actions on hasContext and fires quickAction on pick", () => {
        const form = makeForm(SAMPLE_ACTIONS);
        const picked: AiQuickAction[] = [];
        form.on<AiQuickActionEvent>("quickAction", (_evt, quickAction) => {
            picked.push(quickAction);
        });

        expect(form.quickActionsDropdownView.class).not.toBe("ck-hidden");

        // Opened on an empty selection: "Fix typos" needs content, "Generate" does not.
        const [fixTypos, generate] = quickActionButtons();
        expect(fixTypos.classList.contains("ck-disabled")).toBe(true);
        expect(generate.classList.contains("ck-disabled")).toBe(false);

        fixTypos.click();
        expect(picked).toHaveLength(0);
        generate.click();
        expect(picked.map((quickAction) => quickAction.id)).toEqual(["generate"]);

        // With content (a selection, or a response to chain on) everything unlocks.
        form.hasContext = true;
        expect(fixTypos.classList.contains("ck-disabled")).toBe(false);
        fixTypos.click();
        expect(picked.map((quickAction) => quickAction.prompt)).toEqual(["Write something.", "Fix all mistakes."]);
    });

    it("reset clears the stored contents and view-mode state", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview(true, "<p>diff</p>", "");

        form.reset();
        expect(form.phase).toBe("prompt");
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("");

        // A later streaming run must not resurrect the previous run's diff.
        form.beginStreaming();
        form.enterReview(true, null, "");
        expect(previewHtml()).toBe("");
    });
});
