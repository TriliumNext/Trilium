// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupCodeCopy from "./code_copy.js";

describe("setupCodeCopy", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("adds a button to each code block that copies its code and shows a check mark for a moment", async () => {
        vi.useFakeTimers();
        const writeText = stubClipboard();
        document.body.innerHTML = `<div id="content" data-copy-code-label="Copy code">`
            + `<pre><code class="language-text-x-sh">npm install\npnpm build</code></pre>`
            + `<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>`
            + `<p><code>inline</code></p></div>`;

        setupCodeCopy();

        const buttons = document.querySelectorAll<HTMLButtonElement>("button.copy-button");
        // Neither a diagram, which Mermaid replaces, nor inline code gets a button.
        expect(buttons).toHaveLength(1);
        const [ button ] = buttons;
        expect(button.parentElement?.tagName).toBe("PRE");
        expect(button.type).toBe("button");
        expect(button.getAttribute("aria-label")).toBe("Copy code");
        expect(button.title).toBe("Copy code");

        button.click();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("npm install\npnpm build"));
        expect(button.classList).toContain("copied");
        expect(button.querySelector(".tn-icon")?.classList).toContain("bx-check");

        vi.advanceTimersByTime(1500);
        expect(button.classList).not.toContain("copied");
        expect(button.querySelector(".tn-icon")?.classList).toContain("bx-copy");
    });

    it("shows no check mark when the browser refuses the copy", async () => {
        const writeText = stubClipboard();
        writeText.mockRejectedValueOnce(new Error("Write permission denied."));
        document.body.innerHTML = `<div id="content"><pre><code>x</code></pre></div>`;

        setupCodeCopy();
        const button = document.querySelector<HTMLButtonElement>("button.copy-button");
        expect(button).not.toBeNull();
        button?.click();

        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("x"));
        await Promise.resolve();
        expect(button?.classList).not.toContain("copied");
        expect(button?.querySelector(".tn-icon")?.classList).toContain("bx-copy");
    });

    it("adds no button where the page cannot write to the clipboard, such as over plain HTTP", () => {
        vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
        document.body.innerHTML = `<div id="content" data-copy-code-label="Copy code"><pre><code>x</code></pre></div>`;

        setupCodeCopy();

        expect(document.querySelector("button.copy-button")).toBeNull();
    });
});

function stubClipboard() {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    return writeText;
}
