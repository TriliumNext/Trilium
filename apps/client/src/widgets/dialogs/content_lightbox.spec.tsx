/**
 * The dialog that shows a diagram, a formula or a code block from a text note at full size.
 *
 * These tests pin two things: the payload's `kind` alone picks the title and the renderer, and the
 * dialog handles every later summons. The same instance stays mounted for the rest of the session,
 * so the failure modes to guard against are a stale body and a dialog that cannot reopen.
 */
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ContentLightboxDialog, { type ContentLightboxData } from "./content_lightbox";

const mocks = vi.hoisted(() => ({ applySingleBlockSyntaxHighlight: vi.fn(async () => {}) }));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

// The viewer measures its content and drives react-zoom-pan-pinch, neither of which happy-dom can
// do. Render the children instead: this dialog only decides to wrap the visual kinds in it.
vi.mock("../react/ZoomPanViewer", () => ({
    ZOOM_PAN_HINTS: [],
    default: ({ children, viewportClassName }: { children: ComponentChildren; viewportClassName?: string }) => (
        <div className={viewportClassName}>{children}</div>
    )
}));

vi.mock("../../services/syntax_highlight", () => ({
    applySingleBlockSyntaxHighlight: mocks.applySingleBlockSyntaxHighlight,
    isSyntaxHighlightEnabled: () => true
}));

const MERMAID_SVG = `<svg id="in-mermaid-graph-3-lightbox" width="120" height="80"><g></g></svg>`;
const KATEX_HTML = `<span class="katex"><span class="katex-mathml">x</span></span>`;

describe("ContentLightboxDialog", () => {
    beforeEach(() => {
        mocks.applySingleBlockSyntaxHighlight.mockClear();
    });

    it("shows a mermaid diagram in the zoom/pan viewer", async () => {
        const summon = mountDialog();
        await summon({ kind: "svg", svg: MERMAID_SVG });

        expect(title()).toBe("content_lightbox.diagram_title");
        const body = modalBody();
        expect(body?.querySelector("svg#in-mermaid-graph-3-lightbox")).toBeTruthy();
        expect(body?.querySelector(".code-block")).toBeNull();
    });

    it("shows a formula in the zoom/pan viewer", async () => {
        const summon = mountDialog();
        await summon({ kind: "html", html: KATEX_HTML });

        expect(title()).toBe("content_lightbox.formula_title");
        expect(modalBody()?.querySelector(".katex")).toBeTruthy();
    });

    it("shows code in a code block, highlighted as the language the payload names", async () => {
        const summon = mountDialog();
        await summon({ kind: "code", code: "a { b: c }", language: "text-css" });

        expect(title()).toBe("content_lightbox.code_title");
        expect(modalBody()?.querySelector(".code-block code")?.textContent).toBe("a { b: c }");
        expect(mocks.applySingleBlockSyntaxHighlight).toHaveBeenCalledWith(expect.anything(), "text-css");
    });

    it("replaces what it shows when summoned again while still open", async () => {
        const summon = mountDialog();
        await summon({ kind: "svg", svg: MERMAID_SVG });
        await summon({ kind: "code", code: "second", language: null });

        expect(title()).toBe("content_lightbox.code_title");
        const body = modalBody();
        expect(body?.querySelector("svg#in-mermaid-graph-3-lightbox")).toBeNull();
        expect(body?.querySelector(".code-block code")?.textContent).toBe("second");
    });

    it("can be raised again after it has been closed", async () => {
        const summon = mountDialog();
        await summon({ kind: "svg", svg: MERMAID_SVG });

        const modal = document.querySelector(".modal.content-lightbox");
        expect(modal).toBeTruthy();
        // `hidden.bs.modal` is the only signal that the dialog is down.
        await act(async () => {
            modal?.dispatchEvent(new CustomEvent("hidden.bs.modal", { bubbles: true }));
        });
        expect(modalBody()).toBeNull();

        await summon({ kind: "html", html: KATEX_HTML });
        expect(modalBody()?.querySelector(".katex")).toBeTruthy();
    });
});

/** Mounts the dialog and returns the function that summons it, as the double-click handler does. */
function mountDialog() {
    const host = new Component();
    renderInto(
        <ParentComponent.Provider value={host}>
            <ContentLightboxDialog />
        </ParentComponent.Provider>
    );

    return async (data: ContentLightboxData) => {
        await act(async () => {
            await host.handleEvent("showContentLightbox", data);
        });
    };
}

/** The dialog's body, which is in the page only while the dialog is up. */
function modalBody() {
    return document.querySelector(".modal.content-lightbox .modal-body");
}

function title() {
    return document.querySelector(".modal.content-lightbox .modal-title")?.textContent;
}
