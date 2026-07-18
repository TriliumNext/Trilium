import { Locale } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import LinkEmbedTitleFormView from "./link_embed_title_form.js";

const translate = (_key: string, fallback: string) => fallback;

function createForm(): LinkEmbedTitleFormView {
    const form = new LinkEmbedTitleFormView(new Locale(), translate);
    form.render();
    return form;
}

describe("LinkEmbedTitleFormView", () => {
    it("holds a heading, a Title field and a Save button, and prefills via reset()", () => {
        const form = createForm();

        expect(form.element?.querySelector(".ck-link-embed-form__heading")?.textContent).toBe("Edit title");
        expect(form.titleInputView.label).toBe("Title");
        expect(form.saveButtonView.label).toBe("Save");

        form.reset("Current title");
        expect(form.title).toBe("Current title");
        expect(form.titleInputView.fieldView.value).toBe("Current title");

        form.focus();
        form.destroy();
    });

    it("enables Save only for a non-blank title, and follows typing in the field", () => {
        const form = createForm();

        form.reset("");
        expect(form.saveButtonView.isEnabled).toBe(false);
        form.reset("   ");
        expect(form.saveButtonView.isEnabled).toBe(false);

        const input = form.titleInputView.fieldView.element as HTMLInputElement;
        input.value = "My words";
        form.titleInputView.fieldView.fire("input");
        expect(form.title).toBe("My words");
        expect(form.saveButtonView.isEnabled).toBe(true);

        form.destroy();
    });

    it("turns a native form submit into the view's own submit event", () => {
        const form = createForm();
        const submitted = vi.fn();
        form.on("submit", submitted);

        form.element?.dispatchEvent(new Event("submit", { cancelable: true }));

        expect(submitted).toHaveBeenCalled();
        form.destroy();
    });
});
