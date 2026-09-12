import type { Tooltip } from "bootstrap";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";

const mocks = vi.hoisted(() => ({
    stored: [] as string[],
    saved: [] as string[][],
    /** The tooltip config the list hands the hook, so its title callback can be asked directly. */
    tooltipConfig: undefined as Partial<Tooltip.Options> | undefined
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../services/mime_types", () => ({
    default: {
        loadMimeTypes: () => {},
        getMimeTypes: () => [
            { mime: "text/plain", title: "Plain text", enabled: true },
            { mime: "application/javascript;env=frontend", title: "JavaScript", enabled: true },
            { mime: "text/x-csrc", title: "C", enabled: false },
            { mime: "text/x-java", title: "Java", enabled: false }
        ]
    }
}));

// Which languages each highlighter knows: what the tooltip reports per row.
vi.mock("@triliumnext/highlightjs/src/syntax_highlighting", () => ({
    byMimeType: { "application/javascript;env=frontend": {} }
}));

vi.mock("@triliumnext/codemirror/src/syntax_highlighting", () => ({
    default: { "application/javascript;env=frontend": {}, "text/x-java": {} }
}));

// Captured rather than stubbed away: the callback it holds is what these cases read.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useStaticTooltip: (_ref: unknown, config: Partial<Tooltip.Options>) => {
        mocks.tooltipConfig = config;
    },
    useTriliumOptionJson: () => [ mocks.stored, (value: string[]) => void mocks.saved.push(value) ]
}));

import { CodeMimeTypesList } from "./code_mime_types_list";

/** Asks the tooltip what it would say over the row holding the given MIME type. */
function tooltipFor(container: HTMLElement, mime: string) {
    const label = [ ...container.querySelectorAll<HTMLElement>("label") ]
        .find((candidate) => candidate.querySelector("input")?.value === mime);
    const title = mocks.tooltipConfig?.title;

    return typeof title === "function" && label ? title.call(label) : undefined;
}

describe("the code MIME type list", () => {
    it("files each language under its initial, with plain text kept apart", () => {
        const container = renderInto(<CodeMimeTypesList />);

        // The first group carries no heading: plain text is not filed under a letter.
        const headings = [ ...container.querySelectorAll("h5") ].map((heading) => heading.textContent);
        expect(headings).toEqual([ "C", "J" ]);
    });

    it("shows plain text as on and out of reach, whatever the stored set holds", () => {
        // `mime_types` applies it regardless, so a box reading empty would say the opposite of
        // what happens — and one that cannot be cleared has no business reading empty either.
        for (const stored of [ [], [ "text/plain" ] ]) {
            mocks.stored = stored;
            const plainText = [ ...renderInto(<CodeMimeTypesList />).querySelectorAll<HTMLInputElement>("input") ]
                .find((box) => box.value === "text/plain");

            expect(plainText?.checked).toBe(true);
            expect(plainText?.disabled).toBe(true);
        }
    });

    it("leaves the stored set alone when another language is ticked", () => {
        mocks.stored = [];
        mocks.saved = [];
        const container = renderInto(<CodeMimeTypesList />);

        const java = [ ...container.querySelectorAll<HTMLInputElement>("input") ].find((box) => box.value === "text/x-java");
        java?.dispatchEvent(new Event("change", { bubbles: true }));

        // Plain text is on because the app applies it, not because it was chosen — so choosing
        // something else must not quietly write it into the user's option.
        expect(mocks.saved.at(-1)).toEqual([ "text/x-java" ]);
    });

    it("sorts the languages by name rather than leaving them in the order they arrived", () => {
        const container = renderInto(<CodeMimeTypesList />);
        const titles = [ ...container.querySelectorAll("label") ]
            .map((label) => label.textContent?.trim())
            .filter((title) => title !== "Plain text");

        expect(titles).toEqual([ ...titles ].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
    });

    it("takes back what was ticked, keeping what was already there", () => {
        mocks.stored = [ "text/x-java" ];
        mocks.saved = [];
        const container = renderInto(<CodeMimeTypesList />);

        const c = [ ...container.querySelectorAll<HTMLInputElement>("input") ].find((box) => box.value === "text/x-csrc");
        c?.dispatchEvent(new Event("change", { bubbles: true }));

        expect(mocks.saved.at(-1)).toEqual([ "text/x-java", "text/x-csrc" ]);
    });
});

describe("what the tooltip says about a language", () => {
    it("reports each highlighter separately, since a language may be known to only one", () => {
        const container = renderInto(<CodeMimeTypesList />);

        // Known to both.
        expect(tooltipFor(container, "application/javascript;env=frontend")).toContain("✅");
        expect(tooltipFor(container, "application/javascript;env=frontend")).not.toContain("❌");

        // Known to the code editor but not to the code-block highlighter.
        const java = tooltipFor(container, "text/x-java");
        expect(java).toContain("✅");
        expect(java).toContain("❌");

        // Known to neither.
        expect(tooltipFor(container, "text/x-csrc")).not.toContain("✅");
    });

    it("says nothing at all over plain text, which is not highlighted by anything", () => {
        const container = renderInto(<CodeMimeTypesList />);

        expect(tooltipFor(container, "text/plain")).toBe("");
    });
});
