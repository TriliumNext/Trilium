import {
    _setModelData as setModelData, type ClassicEditor, ContextualBalloon, Essentials, Paragraph,
    View
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import HostedBalloon from "./hosted_balloon.js";

describe("HostedBalloon", () => {
    let editor: ClassicEditor;
    let balloon: ContextualBalloon;
    let hosted: HostedBalloon;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, ContextualBalloon ]);
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        balloon = editor.plugins.get(ContextualBalloon);
        hosted = new HostedBalloon(editor, "test-balloon");
    });

    afterEach(() => {
        hosted.hide();
    });

    it("stays closed while the balloon shows another stack", () => {
        const other = createView(editor);
        balloon.add({
            view: other,
            stackId: "other",
            position: { target: editor.editing.view.getDomRoot() as HTMLElement }
        });
        const add = vi.spyOn(balloon, "add");
        const render = vi.fn((_container: HTMLElement) => () => {});

        hosted.show(render);

        expect(render).not.toHaveBeenCalled();
        expect(balloon.visibleView).toBe(other);
        const hostedView = add.mock.calls[0]?.[0].view;
        expect(hostedView).toBeInstanceOf(View);
        expect(hostedView && balloon.hasView(hostedView)).toBe(false);

        // Closed rather than left open, so it opens once the other stack is gone.
        balloon.remove(other);
        hosted.show(render);
        expect(render).toHaveBeenCalledOnce();
        expect(render.mock.calls[0]?.[0].classList.contains("test-balloon")).toBe(true);
    });

    it("places the balloon again whenever the host's content changes size", async () => {
        const updatePosition = vi.spyOn(balloon, "updatePosition");
        const render = vi.fn((_container: HTMLElement) => () => {});
        hosted.show(render);
        const container = render.mock.calls[0]?.[0];
        if (!container) {
            throw new Error("The host was not asked to render.");
        }

        // The host renders into the container after `show()` returns.
        container.textContent = "Rendered by the host";
        await vi.waitFor(() => expect(updatePosition).toHaveBeenCalled());

        updatePosition.mockClear();
        container.style.width = "300px";
        await vi.waitFor(() => expect(updatePosition).toHaveBeenCalled());
    });
});

function createView(editor: ClassicEditor) {
    const view = new View(editor.locale);
    view.setTemplate({ tag: "div" });
    return view;
}
