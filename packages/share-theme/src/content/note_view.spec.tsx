// @vitest-environment happy-dom
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppPayload, HostedApp } from "./app_host.js";
import mountNoteView from "./note_view.js";

const { loadCodeView } = vi.hoisted(() => ({ loadCodeView: vi.fn() }));

// The real modules reach `window.glob`, which only the app's boot script defines.
vi.mock("@triliumnext/client/src/services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("@triliumnext/client/src/widgets/react/hooks.js", () => ({ useNoteBlob: () => null }));
vi.mock("@triliumnext/client/src/widgets/note_types.js", () => ({
    TYPE_MAPPINGS: { code: { view: loadCodeView, className: "note-detail-code" } }
}));

vi.mock("./app_host.js", () => ({
    default: ({ noteId, children }: {
        noteId: string;
        children(app: HostedApp): ComponentChildren;
    }) =>
        children({ note: { noteId, type: "code" }, parentNoteId: null } as unknown as HostedApp)
}));

describe("mountNoteView", () => {
    afterEach(() => {
        document.body.replaceChildren();
        loadCodeView.mockReset();
    });

    it("replaces the rendered content with the note's widget once the widget loads", async () => {
        loadCodeView.mockResolvedValue({ default: () => <p className="widget">Widget</p> });
        const container = buildContainer();

        await act(() => mountNoteView(container, buildPayload()));

        expect(container.querySelector(".note-detail-code > p.widget")?.textContent).toBe("Widget");
        expect(container.querySelector("p.fallback")).toBeNull();
    });

    it("keeps the rendered content when the widget fails to load", async () => {
        loadCodeView.mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
        const container = buildContainer();

        await act(async () => {
            await expect(mountNoteView(container, buildPayload()))
                .rejects.toThrow("Failed to fetch");
        });

        expect(container.querySelector("p.fallback")?.textContent).toBe("Rendered");
        expect(container.querySelector(".note-detail-code")).toBeNull();
    });
});

function buildContainer() {
    const container = document.createElement("div");
    container.dataset.noteId = "codeNote";
    container.innerHTML = `<p class="fallback">Rendered</p>`;
    document.body.append(container);
    return container;
}

function buildPayload() {
    return {
        notes: [ { noteId: "codeNote", type: "code" } ],
        branches: [],
        attributes: [],
        links: {},
        options: {},
        assetPath: "",
        parentNoteId: null
    } as unknown as AppPayload;
}
