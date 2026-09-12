/**
 * A revision is stored as CKEditor's data downcast output, which is not always self-contained: the
 * constructs whose visible content the note view builds at render time arrive here as empty
 * elements carrying metadata. Rendering the stored HTML on its own therefore shows less than the
 * note does, and in the case of a link preview shows nothing at all (#10707).
 */
import HtmlDiff from "htmldiff-js";
import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { RevisionContentText, seedLinkPreviewTitles } from "./revisions";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

/**
 * Every fixture starts with a paragraph that is not the subject of its assertion: DOMPurify running
 * on happy-dom unwraps the outermost element of the fragment it is given (`<p>x</p>` sanitizes to
 * `x`), which real browsers do not do, so the element under test must not be the first one.
 */

/** Renders revision HTML and lets the reference-link lookups (froca, then the icon) settle. */
async function renderRevision(content: string) {
    const container = renderInto(<RevisionContentText content={content} />);
    await vi.waitFor(() => expect(container.querySelector(".ck-content")).toBeTruthy());
    return container;
}

describe("RevisionContentText", () => {
    it("renders an inline link preview that is stored as an empty element", async () => {
        const container = await renderRevision(
            '<p>before</p><p><span class="link-mention" data-url="https://github.com/TriliumNext/Trilium/issues"'
            + ' data-title="Issues · TriliumNext/Trilium"></span></p><p>after</p>'
        );

        const mention = await vi.waitFor(() => {
            const el = container.querySelector<HTMLAnchorElement>("span.link-mention a.link-embed-mention");
            expect(el).toBeTruthy();
            return el;
        });
        expect(mention?.textContent).toBe("Issues · TriliumNext/Trilium");
        expect(mention?.getAttribute("href")).toBe("https://github.com/TriliumNext/Trilium/issues");
    });

    it("renders a card link preview that is stored as an empty element", async () => {
        const container = await renderRevision(
            '<p>before</p><section class="link-embed" data-url="https://example.com/post" data-title="A post"'
            + ' data-site-name="Example"></section>'
        );

        await vi.waitFor(() => {
            expect(container.querySelector("section.link-embed")?.textContent).toContain("A post");
        });
    });

    it("resolves reference link titles against the current note tree", async () => {
        const note = buildNote({ title: "Target note" });
        const container = await renderRevision(
            `<p><a class="reference-link" href="#root/${note.noteId}">Stale title</a></p>`
        );

        // The stored title is whatever it was when the revision was taken; the note view replaces it
        // with the note's own, wrapped in the <span> the theme styles.
        await vi.waitFor(() => {
            const link = container.querySelector("a.reference-link > span");
            expect(link?.textContent).toContain("Target note");
        });
    });

    it("leaves a preview without a URL alone rather than rendering an empty card", async () => {
        const container = await renderRevision('<p>before</p><p><span class="link-mention" data-title="No URL"></span></p>');

        expect(container.querySelector("a.link-embed-mention")).toBeNull();
    });
});

describe("seedLinkPreviewTitles", () => {
    const mention = '<span class="link-mention" data-url="https://example.com/post" data-title="A post"></span>';

    /** The anchor the seeding put inside the preview, as the diff view would end up rendering it. */
    function seededLink(html: string) {
        const doc = new DOMParser().parseFromString(seedLinkPreviewTitles(html) ?? "", "text/html");
        return doc.querySelector<HTMLAnchorElement>("a.link-embed-mention");
    }

    it("fills a preview with a link carrying the title it displays", () => {
        const link = seededLink(`<p>x</p>${mention}`);
        expect(link?.textContent).toBe("A post");
        expect(link?.getAttribute("href")).toBe("https://example.com/post");
        expect(link?.closest("span.link-mention")).toBeTruthy();

        // No title was ever fetched for this one, so it is named the way the card would name it.
        const untitled = seededLink('<section class="link-embed" data-url="https://example.com/post"></section>');
        expect(untitled?.textContent).toBe("example.com");
    });

    it("leaves a preview naming nothing at all alone rather than adding an empty link", () => {
        expect(seededLink('<span class="link-mention"></span>')).toBeNull();
    });

    it("passes content it has nothing to do with straight through", () => {
        // Identity rather than a re-serialization, so an ordinary diff is untouched by this.
        const plain = "<p>x</p><p><a href='https://example.com'>y</a></p>";
        expect(seedLinkPreviewTitles(plain)).toBe(plain);
        expect(seedLinkPreviewTitles(undefined)).toBeUndefined();
    });

    it("leaves a preview that already carries text alone", () => {
        const filled = '<span class="link-mention" data-title="A post">Edited by hand</span>';
        expect(seedLinkPreviewTitles(filled)).toContain(">Edited by hand</span>");
    });

    it("lets the differ tell an added preview from a removed one", () => {
        const withPreview = seedLinkPreviewTitles(`<p>x</p><p>${mention}</p>`);
        const without = seedLinkPreviewTitles("<p>x</p>");

        const added = HtmlDiff.execute(without, withPreview);
        const removed = HtmlDiff.execute(withPreview, without);

        expect(added).toContain("diffins");
        expect(removed).toContain("diffdel");
        // Unseeded, htmldiff-js emits these two byte-identical: the empty element carries no word
        // for it to compare, so neither direction produces a marker at all.
        expect(added).not.toBe(removed);
    });
});
