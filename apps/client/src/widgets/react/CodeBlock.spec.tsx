import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applySingleBlockSyntaxHighlight = vi.fn(async (_codeBlock: unknown, _normalizedMimeType: string) => {});
const isSyntaxHighlightEnabled = vi.fn(() => true);

vi.mock("../../services/syntax_highlight", () => ({
    applySingleBlockSyntaxHighlight,
    isSyntaxHighlightEnabled
}));

vi.mock("../../services/clipboard_ext", () => ({ copyTextWithToast: vi.fn() }));

// ActionButton drags in tooltips and command wiring that are irrelevant here.
vi.mock("./ActionButton", () => ({ default: () => <button class="code-block-copy" /> }));

const { default: CodeBlock } = await import("./CodeBlock");

let container: HTMLDivElement;

beforeEach(() => {
    // The component hands the <code> element to jQuery before delegating to the
    // highlighter; the identity wrapper is enough since the helper itself is mocked.
    (globalThis as unknown as { $: (el: unknown) => unknown }).$ = (el) => el;
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
    isSyntaxHighlightEnabled.mockReturnValue(true);
});

describe("CodeBlock", () => {
    it("renders the code as text, never as markup", () => {
        render(<CodeBlock code={"<img src=x onerror=alert(1)>"} />, container);

        const code = container.querySelector("code");
        expect(code?.textContent).toBe("<img src=x onerror=alert(1)>");
        // Rendered verbatim rather than parsed — no element was created from it.
        expect(container.querySelector("img")).toBeNull();
    });

    it("does not highlight when no MIME type is given", () => {
        render(<CodeBlock code={"{}"} />, container);
        expect(applySingleBlockSyntaxHighlight).not.toHaveBeenCalled();
    });

    it("respects the user turning syntax highlighting off", () => {
        isSyntaxHighlightEnabled.mockReturnValue(false);
        render(<CodeBlock code={"{}"} mimeType="application/json" />, container);
        expect(applySingleBlockSyntaxHighlight).not.toHaveBeenCalled();
    });

    it("highlights with the normalized MIME type when enabled", async () => {
        render(<CodeBlock code={'{"a": 1}'} mimeType="application/json" />, container);

        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(1));
        // highlight.js registers languages under the CKEditor-normalized name, so
        // "application/json" must reach it as "application-json" or nothing matches.
        expect(applySingleBlockSyntaxHighlight.mock.calls[0][1]).toBe("application-json");
    });

    it("forces the hljs class on rather than toggling it, so a re-highlight keeps colours", async () => {
        const rerender = (code: string) => render(<CodeBlock code={code} mimeType="application/json" />, container);

        rerender('{"a": 1}');
        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(1));
        expect(container.querySelector("pre")?.classList.contains("hljs")).toBe(true);

        // The underlying helper toggles the class; a second pass must not switch it off.
        rerender('{"a": 2}');
        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(2));
        expect(container.querySelector("pre")?.classList.contains("hljs")).toBe(true);
    });

    it("marks every occurrence of the placeholder without altering the code", () => {
        render(<CodeBlock code={"a TOKEN b TOKEN c"} placeholder="TOKEN" />, container);

        const marks = container.querySelectorAll(".code-block-placeholder");
        expect(marks.length).toBe(2);
        expect([...marks].map((m) => m.textContent)).toEqual(["TOKEN", "TOKEN"]);
        // Marking is purely decorative — what gets copied must still be the original.
        expect(container.querySelector("code")?.textContent).toBe("a TOKEN b TOKEN c");
    });

    it("re-marks the placeholder after highlighting rebuilds the subtree", async () => {
        // The real highlighter rebuilds the subtree, wiping the marks added on first paint.
        // Built through the DOM rather than by assigning innerHTML: the wipe is what this
        // test needs, and reinterpreting the element's own text as markup would be both
        // pointless here and the shape of an XSS sink.
        applySingleBlockSyntaxHighlight.mockImplementationOnce(async (codeBlock: unknown) => {
            const element = codeBlock as HTMLElement;
            const token = document.createElement("span");
            token.className = "hljs-string";
            token.textContent = element.textContent;
            element.replaceChildren(token);
        });

        render(<CodeBlock code={'"Bearer TOKEN"'} mimeType="application/json" placeholder="TOKEN" />, container);

        // Nested inside the token span, which is why the CSS has to outrank hljs colours.
        await vi.waitFor(() => expect(container.querySelector(".hljs-string > .code-block-placeholder")).not.toBeNull());
        expect(container.querySelectorAll(".code-block-placeholder").length).toBe(1);
        expect(container.querySelector("code")?.textContent).toBe('"Bearer TOKEN"');
    });

    it("rewrites the plain text when the code changes", () => {
        render(<CodeBlock code={"first"} />, container);
        expect(container.querySelector("code")?.textContent).toBe("first");

        render(<CodeBlock code={"second"} />, container);
        expect(container.querySelector("code")?.textContent).toBe("second");
    });
});
