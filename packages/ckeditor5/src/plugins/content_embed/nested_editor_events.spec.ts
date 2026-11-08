import { FocusObserver, InputObserver, Paragraph } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import "./nested_editor_events.js";

afterEach(() => {
    for (const marker of document.querySelectorAll("body > [data-cke-ignore-events]")) {
        marker.remove();
    }
});

describe("nested editor events", () => {
    it("lets an editor inside an element marked to be ignored handle its own events", async () => {
        const editor = await createTestEditor([ Paragraph ]);
        const root = getDomRoot(editor);
        // The wrapper of an embed, as the outer editor renders it.
        const marker = document.createElement("div");
        marker.dataset.ckeIgnoreEvents = "true";
        document.body.append(marker);
        marker.append(root);
        editor.setData("<p>ab</p>");

        root.focus();
        await vi.waitFor(() => expect(editor.editing.view.document.isFocused).toBe(true));
        const input = editor.editing.view.getObserver(InputObserver);
        const paragraph = root.querySelector("p");
        expect(input?.checkShouldIgnoreEventFromTarget(paragraph)).toBe(false);
    });

    it("still ignores the events from inside an element marked in the editor's own root", async () => {
        const editor = await createTestEditor([ Paragraph ]);
        const root = getDomRoot(editor);
        const marker = document.createElement("div");
        marker.dataset.ckeIgnoreEvents = "true";
        const inner = document.createElement("span");
        marker.append(inner);
        root.append(marker);
        const outside = document.createElement("span");
        const outerMarker = document.createElement("div");
        outerMarker.dataset.ckeIgnoreEvents = "true";
        outerMarker.append(outside);
        document.body.append(outerMarker);

        const observer = editor.editing.view.getObserver(FocusObserver);
        expect(observer?.checkShouldIgnoreEventFromTarget(inner)).toBe(true);
        expect(observer?.checkShouldIgnoreEventFromTarget(inner.appendChild(new Text("x"))))
            .toBe(true);
        expect(observer?.checkShouldIgnoreEventFromTarget(root)).toBe(false);
        expect(observer?.checkShouldIgnoreEventFromTarget(outside)).toBe(true);
        expect(observer?.checkShouldIgnoreEventFromTarget(null)).toBe(false);
    });
});

function getDomRoot(editor: Awaited<ReturnType<typeof createTestEditor>>) {
    const root = editor.editing.view.getDomRoot();
    if (!root) throw new Error("Expected the editable root of the editor.");
    return root;
}
