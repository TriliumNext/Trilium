import { render } from "preact";
import { describe, expect, it, vi } from "vitest";

// i18n returns the key so assertions stay stable regardless of locale strings.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

// NoteLink pulls in link/tree/froca machinery; stub it to a marker carrying the note path.
vi.mock("./NoteLink", () => ({
    default: ({ notePath }: { notePath: string }) => <a className="note-link-stub" data-note-path={notePath} />
}));

import RenderErrorCard from "./RenderErrorCard";

describe("RenderErrorCard", () => {
    it("shows the whole single-line error as the summary, with no details collapsible", () => {
        const container = mount(<RenderErrorCard error="boom" />);

        expect(container.querySelector(".render-error-message")?.textContent).toBe("boom");
        expect(container.querySelector(".render-error-card pre")).toBeNull();
    });

    it("splits a multi-line error into a headline summary and a details block", () => {
        const container = mount(<RenderErrorCard error={"first line\nstack line 1\nstack line 2"} />);

        expect(container.querySelector(".render-error-message")?.textContent).toBe("first line");
        expect(container.querySelector(".render-error-card pre")?.textContent).toBe("stack line 1\nstack line 2");
    });

    it("reads the message off an Error instance", () => {
        const container = mount(<RenderErrorCard error={new Error("kaput")} />);

        expect(container.querySelector(".render-error-message")?.textContent).toBe("kaput");
    });

    it("unwraps the bundler's wrapper via the cause chain and shows only the root cause", () => {
        const wrapped = new Error(
            `Load of script note "My script" (abc123) failed with: boom`,
            { cause: new Error("boom") }
        );
        const container = mount(<RenderErrorCard error={wrapped} noteId="abc123" />);

        expect(container.querySelector(".render-error-message")?.textContent).toBe("boom");
    });

    it("links to the failing script note when a noteId is given", () => {
        const container = mount(<RenderErrorCard error="boom" noteId="abc123" />);

        const link = container.querySelector(".render-error-note .note-link-stub");
        expect(link?.getAttribute("data-note-path")).toBe("abc123");
    });

    it("omits the note reference when no noteId is given", () => {
        const container = mount(<RenderErrorCard error="boom" />);

        expect(container.querySelector(".render-error-note")).toBeNull();
    });
});

function mount(vnode: ReturnType<typeof RenderErrorCard>) {
    const container = document.createElement("div");
    render(vnode, container);
    return container;
}
