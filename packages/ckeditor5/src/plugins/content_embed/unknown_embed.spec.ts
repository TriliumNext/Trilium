import { ClassicEditor, Essentials, GeneralHtmlSupport, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import ContentEmbed from "./content_embed.js";
import UnknownContentEmbed from "./unknown_embed.js";

const CONTENT = "<p>Open in a   newer version</p>\n<p>of Trilium</p>";
const SAVED = `<section class="future" data-trilium-embed="future-kind" data-note-id="abc">`
    + `${CONTENT}</section>`;

describe("UnknownContentEmbed", () => {
    let editor: ClassicEditor;
    let sanitizeHtml: ReturnType<typeof vi.fn<(html: string) => string>>;
    let loadUnknown: ReturnType<typeof vi.fn<(wrapper: HTMLElement, boxSize?: string) => void>>;

    beforeEach(async () => {
        sanitizeHtml = vi.fn((html: string) => html.replace(/ onerror="[^"]*"/g, ""));
        loadUnknown = vi.fn();
        editor = await createTestEditor([ Essentials, Paragraph, UnknownContentEmbed ], {
            contentEmbed: { sanitizeHtml, loadUnknown }
        });
    });

    it("saves the section unchanged, keeping only its class and data-* attributes", () => {
        editor.setData(`<section class="future" data-trilium-embed="future-kind" style="color:red"`
            + ` data-note-id="abc" onclick="alert(1)">${CONTENT}</section>`);

        expect(sanitizeHtml).toHaveBeenCalledWith(CONTENT);
        expect(editor.getData()).toBe(SAVED);

        editor.setData(SAVED);
        expect(editor.getData()).toBe(SAVED);
    });

    it("has the host fill an embed box instead of the content, at the section's box size", () => {
        editor.setData(SAVED + SAVED.replace(` data-note-id="abc"`, ` data-box-size="small"`));

        const sections = getPlaceholders(editor);
        expect(sections).toHaveLength(2);
        const wrappers = sections
            .map((section) => section.querySelector(":scope > .include-note-wrapper"));
        for (const section of sections) {
            expect([ ...section.classList ]).toEqual(expect.arrayContaining([
                "include-note", "unknown-content-embed", "ck-widget"
            ]));
            expect(section.getAttribute("data-trilium-embed")).toBe("future-kind");
            expect(section.querySelector("p")).toBeNull();
        }
        expect(sections[0].hasAttribute("data-box-size")).toBe(false);
        expect(sections[1].getAttribute("data-box-size")).toBe("small");
        expect(wrappers[0]).toBeInstanceOf(HTMLElement);
        expect(loadUnknown.mock.calls).toEqual([
            [ wrappers[0], undefined ], [ wrappers[1], "small" ]
        ]);
    });

    it("is not an embed that the content embed menu acts on", async () => {
        const withEmbeds = await createTestEditor([ Essentials, Paragraph, ContentEmbed ], {
            contentEmbed: { sanitizeHtml }
        });
        withEmbeds.setData(SAVED);

        const [ section ] = getPlaceholders(withEmbeds);
        expect(section).toBeInstanceOf(HTMLElement);
        expect(withEmbeds.plugins.get("ContentEmbed").getEmbedStateAt(section)).toBeNull();
    });

    it("sanitizes a pasted section", () => {
        editor.setData("<p>start</p>");

        const dataTransfer = recordingDataTransfer();
        dataTransfer.setData("text/html", `<section data-trilium-embed="future-kind">`
            + `<img src="x.png" onerror="alert(1)"></section>`);
        editor.editing.view.document.fire("paste", {
            dataTransfer, preventDefault: () => {}, stopPropagation: () => {}
        });

        expect(editor.getData()).toContain(
            `<section data-trilium-embed="future-kind"><img src="x.png"></section>`);
    });

    it("takes the section before General HTML Support does", async () => {
        const withHtmlSupport = await createTestEditor([
            Essentials, Paragraph, GeneralHtmlSupport, UnknownContentEmbed
        ], {
            contentEmbed: { sanitizeHtml },
            htmlSupport: { allow: [ { name: "section", attributes: true, classes: true } ] }
        });

        withHtmlSupport.setData(SAVED);

        expect(withHtmlSupport.getData()).toBe(SAVED);
    });

    it("refuses to load the section without a sanitizer", async () => {
        const withoutSanitizer = await createTestEditor([
            Essentials, Paragraph, UnknownContentEmbed
        ]);

        expect(() => withoutSanitizer.setData(SAVED))
            .toThrow(/content-embed-sanitize-html-required/);
    });
});

function getPlaceholders(editor: ClassicEditor) {
    return [ ...editor.editing.view.getDomRoot()?.querySelectorAll("section") ?? [] ];
}

function recordingDataTransfer() {
    const store: Record<string, string> = {};
    return {
        setData: (type: string, data: string) => { store[type] = data; },
        getData: (type: string) => store[type] ?? ""
    };
}
