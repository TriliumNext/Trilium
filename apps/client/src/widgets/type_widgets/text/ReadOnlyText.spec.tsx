import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Imported by ReadOnlyText only for its content styles — irrelevant (and heavy) under happy-dom.
vi.mock("@triliumnext/ckeditor5", () => ({}));
vi.mock("../../../services/content_renderer_text", () => ({
    applyInlineMermaid: vi.fn(async () => {}),
    rewriteMermaidDiagramsInContainer: vi.fn(async () => {})
}));
vi.mock("../../../services/link_embed", () => ({ applyLinkEmbeds: vi.fn(async () => {}) }));
vi.mock("../../../services/math", () => ({ renderMathInElement: vi.fn() }));
vi.mock("../../../services/syntax_highlight", () => ({ formatCodeBlocks: vi.fn(async () => {}) }));
vi.mock("../../../services/search_jump", () => ({ consumeSearchTerms: vi.fn() }));
vi.mock("./read_only_helper", () => ({ applyReferenceLinks: vi.fn(async () => {}) }));
vi.mock("./utils", () => ({
    loadIncludedNote: vi.fn(async () => {}),
    refreshIncludedNote: vi.fn(),
    setupImageOpening: vi.fn()
}));

import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import type { ViewScope } from "../../../services/link";
import ReadOnlyText from "./ReadOnlyText";

function makeNote(blobPromise: Promise<unknown>) {
    return {
        noteId: "note1",
        getBlob: () => blobPromise,
        getLabelValue: () => null
    } as unknown as FNote;
}

describe("ReadOnlyText ?bookmark= handling", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("keeps the bookmark until the content renders, then expands the collapsible and consumes it", async () => {
        let resolveBlob!: (blob: unknown) => void;
        const note = makeNote(new Promise((resolve) => { resolveBlob = resolve; }));
        const viewScope: ViewScope = { bookmark: "deep-anchor" };
        const noteContext = {
            viewScope,
            setContextData: vi.fn()
        } as unknown as NoteContext;

        await act(async () => {
            render(
                <ReadOnlyText
                    note={note}
                    noteContext={noteContext}
                    ntxId={null}
                    viewScope={viewScope}
                    parentComponent={undefined}
                />,
                container
            );
        });

        // The mount effect runs while the blob is still loading (empty container) — it must not
        // consume the bookmark yet, or the post-load pass has nothing left to reveal.
        expect(viewScope.bookmark).toBe("deep-anchor");

        await act(async () => {
            resolveBlob({
                content:
                    `<details class="trilium-collapsible"><summary>Hidden</summary>` +
                    `<p><a id="deep-anchor"></a>target</p></details>`
            });
        });

        const details = container.querySelector("details");
        expect(details?.open).toBe(true);
        expect(viewScope.bookmark).toBeUndefined();
    });
});
