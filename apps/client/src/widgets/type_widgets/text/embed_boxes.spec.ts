import { getNoteEmbedHref } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./utils", () => ({
    getAttachmentHref: vi.fn(),
    loadEmbeddedAttachment: vi.fn(async () => {}),
    loadEmbeddedNote: vi.fn(async () => {}),
    loadInlineEmbed: vi.fn(async () => {}),
    loadMediaEmbed: vi.fn(async () => {}),
    loadUnknownEmbed: vi.fn(async () => {})
}));
vi.mock("../../../services/link", () => ({
    default: {
        loadReferenceLinkTitle: vi.fn(async ($element: JQuery<HTMLElement>, href: string) => {
            $element.text(`Title of ${href}`);
        })
    }
}));
vi.mock("mermaid", () => ({
    default: {
        initialize: vi.fn(),
        render: async (_id: string, source: string) => ({ svg: `<svg>${source}</svg>` })
    }
}));

import link from "../../../services/link";
import { prepareEmbedBoxes } from "./embed_boxes";
import {
    getAttachmentHref, loadEmbeddedAttachment, loadEmbeddedNote, loadInlineEmbed
} from "./utils";

beforeEach(() => {
    vi.clearAllMocks();
});

function buildContent(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
}

describe("prepareEmbedBoxes", () => {
    it("fills a box per note and attachment, whose content knows the notes around it", async () => {
        const container = buildContent(
            `<figure class="include-note" data-note-id="noteA" data-block="b1"`
            + ` data-box-size="small"></figure>`
            + `<figure class="include-note" data-attachment-id="att1"></figure>`
            + `<figure class="include-note"></figure>`);
        const [ noteEmbed, attachmentEmbed ] = container.children;

        const loadBoxes = prepareEmbedBoxes(container, {
            seenNoteIds: new Set([ "outer" ]), hostNoteId: "host"
        }, true);

        // The passes between the two calls read the box sizes of this version.
        expect(noteEmbed.getAttribute("data-box-size")).toBe("compact");
        expect(attachmentEmbed.getAttribute("data-box-size")).toBe("compact");
        expect(loadEmbeddedNote).not.toHaveBeenCalled();

        await loadBoxes();

        const shownNoteIds = new Set([ "outer", "host" ]);
        expect(vi.mocked(loadEmbeddedNote).mock.calls).toEqual([ [
            "noteA", expect.anything(), undefined,
            { block: "b1", seenNoteIds: shownNoteIds, isNested: true }
        ] ]);
        expect(vi.mocked(loadEmbeddedNote).mock.calls[0][1][0]).toBe(noteEmbed);
        expect(vi.mocked(loadEmbeddedAttachment).mock.calls).toEqual([ [
            "att1", expect.anything(), undefined, { seenNoteIds: shownNoteIds, isNested: true }
        ] ]);
        expect(vi.mocked(loadEmbeddedAttachment).mock.calls[0][1][0]).toBe(attachmentEmbed);
    });

    it("shows the embeds of the content of another embed as a title row alone", async () => {
        const html = `<figure class="include-note" data-note-id="noteA" data-box-size="small"`
            + ` style="--include-note-height:20em"></figure>`
            + `<figure class="include-note" data-attachment-id="att1"`
            + ` data-box-size="full"></figure>`;

        const topLevel = buildContent(html);
        await prepareEmbedBoxes(topLevel, { seenNoteIds: new Set() })();
        expect([ ...topLevel.children ].map((embed) => embed.getAttribute("data-box-size")))
            .toEqual([ "resizable", "full" ]);

        const nested = buildContent(html);
        await prepareEmbedBoxes(nested, { seenNoteIds: new Set() }, true)();
        expect([ ...nested.children ].map((embed) => embed.getAttribute("data-box-size")))
            .toEqual([ "compact", "compact" ]);
        expect(vi.mocked(loadEmbeddedNote).mock.lastCall?.[1][0]).toBe(nested.children[0]);
        expect(vi.mocked(loadEmbeddedAttachment).mock.lastCall?.[1][0])
            .toBe(nested.children[1]);
    });

    it("links to the notes and attachments shown around it, so that a cycle stops", async () => {
        const attachmentHref = "#root/owner?viewMode=attachments&attachmentId=drawing";
        vi.mocked(getAttachmentHref).mockResolvedValue(attachmentHref);
        const container = buildContent(
            `<figure class="include-note" data-note-id="parent"></figure>`
            + `<figure class="include-note" data-note-id="sibling" data-block="b1"></figure>`
            + `<figure class="include-note" data-note-id="sibling"></figure>`
            + `<figure class="include-note" data-attachment-id="drawing"></figure>`);
        const wholeSibling = container.children[2];

        await prepareEmbedBoxes(container, {
            seenNoteIds: new Set([ "parent", "sibling:b1", "drawing" ]), hostNoteId: "host"
        })();

        const hrefs = [ getNoteEmbedHref("parent", undefined), getNoteEmbedHref("sibling", "b1") ];
        const escapedHref = attachmentHref.replaceAll("&", "&amp;");
        expect([ ...container.children ].map((child) => child.outerHTML)).toEqual([
            `<a class="reference-link" href="${hrefs[0]}"><span>Title of ${hrefs[0]}</span></a>`,
            `<a class="reference-link" href="${hrefs[1]}"><span>Title of ${hrefs[1]}</span></a>`,
            wholeSibling.outerHTML,
            `<a class="reference-link" href="${escapedHref}">`
            + `<span>Title of ${escapedHref}</span></a>`
        ]);
        expect(vi.mocked(link.loadReferenceLinkTitle).mock.calls.map((call) => call[2]))
            .toEqual([ "host", "host", "host" ]);
        // The whole of a note whose blocks are shown around it is no cycle.
        expect(vi.mocked(loadEmbeddedNote).mock.calls.map((call) => call[0]))
            .toEqual([ "sibling" ]);
        expect(loadEmbeddedAttachment).not.toHaveBeenCalled();
    });

    it("draws diagrams in place while the content changes as it is typed", async () => {
        const html = `<pre data-box-size="resizable">`
            + `<code class="language-mermaid">graph TD;</code></pre>`;

        const boxed = buildContent(html);
        await prepareEmbedBoxes(boxed, { seenNoteIds: new Set() }, true)();
        expect(boxed.querySelector("figure.include-note")?.getAttribute("data-language"))
            .toBe("mermaid");
        expect(vi.mocked(loadInlineEmbed).mock.lastCall?.[3]).toEqual({
            isFocused: false, isNested: true
        });

        vi.mocked(loadInlineEmbed).mockClear();
        const changing = buildContent(html);
        const loadBoxes = prepareEmbedBoxes(changing, { seenNoteIds: new Set(), isChanging: true });
        expect(changing.querySelector(".rendered-mermaid-diagram")?.textContent).toBe("graph TD;");
        await loadBoxes();
        expect(changing.querySelector(".rendered-mermaid-diagram")?.innerHTML)
            .toBe("<svg>graph TD;</svg>");
        expect(loadInlineEmbed).not.toHaveBeenCalled();
    });
});
