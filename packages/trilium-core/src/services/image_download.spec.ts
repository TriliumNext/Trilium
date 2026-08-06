import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import { downloadImages, downloadPictureToAttachment, storeLinkPreviewPictures } from "./image_download.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import { initRequest } from "./request.js";

/**
 * Runs against the real in-memory fixture DB booted by the server suite setup, through which
 * co-located trilium-core specs run. The network is the only thing stood in for.
 */

let counter = 0;

/** Creates a fresh text note under root, uniquely titled since the fixture DB is shared. */
function createNote(content: string): BNote {
    counter++;

    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `image-download-spec-${counter}`,
            content,
            type: "text"
        })
    ).note;
}

/** A 1x1 PNG. The bytes are asked what they are, so a placeholder buffer would rightly be refused. */
const PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
);

/** A vector icon, as GitHub and a good many other sites serve. Markup, so its bytes are text. */
const TINY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>`;

const card = (url: string, favicon: string, image?: string) =>
    `<section class="link-embed" data-url="${url}" data-embed-type="opengraph" data-favicon="${favicon}"`
    + `${image ? ` data-image="${image}"` : ""}></section>`;

/**
 * Stands in for the network. The suite boots no request provider, so one is installed here and
 * taken away again — leaving a stub in place would answer for whatever else shares this worker.
 */
let asked: string[] = [];
let answerWith: (url: string) => Buffer | undefined = () => PIXEL_PNG;

beforeAll(() => {
    initRequest({
        exec: async () => { throw new Error("Not used by these tests."); },
        getImage: async (url: string) => {
            asked.push(url);
            const bytes = answerWith(url);

            if (!bytes) {
                throw new Error(`404 ${url}`);
            }

            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        }
    });
});

afterAll(() => {
    initRequest({
        exec: async () => { throw new Error("Request provider not initialized. Call initRequest() first."); },
        getImage: async () => { throw new Error("Request provider not initialized. Call initRequest() first."); }
    });
});

beforeEach(() => {
    asked = [];
    answerWith = () => PIXEL_PNG;
});

/**
 * Lets whatever a save started run to wherever it gets to.
 *
 * `downloadImages` answers without waiting for the network — a save cannot be held up by someone
 * else's server — so a test that asserts nothing was fetched has to give the fetch that was not
 * started the chance to have been.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("downloadPictureToAttachment (real DB)", () => {
    it("keeps the picture as an attachment under the role and title it is given", async () => {
        const note = createNote("<p>x</p>");

        const reference = await getContext().init(() => downloadPictureToAttachment(note.noteId, "https://example.com/icon.png", {
            role: "favicon",
            title: "example.com"
        }));

        const [ attachment ] = note.getAttachments();
        // The extension comes from what the bytes are, not from the address they came from.
        expect(attachment).toMatchObject({ role: "favicon", title: "example.com.png" });
        expect(reference).toBe(`api/attachments/${attachment.attachmentId}/image/example.com.png`);
    });

    it("asks for nothing at an address that is not a website", async () => {
        // The address reaches this from note content, so it is whatever was written there.
        const note = createNote("<p>x</p>");

        for (const address of [ "file:///etc/passwd", "data:image/png;base64,AAAA", "api/attachments/a/image/b.png", "" ]) {
            expect(await getContext().init(() => downloadPictureToAttachment(note.noteId, address, { role: "image", title: "x" }))).toBeUndefined();
        }

        expect(asked).toEqual([]);
    });

    it("refuses what comes back if it is not a picture", async () => {
        // A 404 page served where a picture should be is the ordinary case.
        const note = createNote("<p>x</p>");
        answerWith = () => Buffer.from("<html>Not found</html>");

        expect(await getContext().init(() => downloadPictureToAttachment(note.noteId, "https://example.com/gone.png", {
            role: "image",
            title: "x"
        }))).toBeUndefined();
        expect(note.getAttachments()).toHaveLength(0);
    });

    it("answers with nothing when the address cannot be reached", async () => {
        const note = createNote("<p>x</p>");
        answerWith = () => undefined;

        expect(await getContext().init(() => downloadPictureToAttachment(note.noteId, "https://example.com/x.png", {
            role: "image",
            title: "x"
        }))).toBeUndefined();
    });
});

describe("downloadImages (real DB)", () => {
    it("reads a src past the attributes written before it, and knows an attachment's own", () => {
        // The tag is bounded in how far it is read for a `src`, so what an editor actually writes
        // before one — a class, a style, an alt — has to still be found past it.
        const note = createNote("<p>x</p>");
        const pasted = `<img class="image_resized" style="width:53.68%;" alt="a pasted picture"`
            + ` src="data:image/png;base64,${PIXEL_PNG.toString("base64")}">`;
        const stored = `<img src="api/attachments/abc123456789/image/kept.png">`;

        const rewritten = getContext().init(() => downloadImages(note.noteId, `<p>${pasted}${stored}</p>`));

        const [ attachment ] = note.getAttachments();
        expect(rewritten).toContain(`<img src="api/attachments/${attachment.attachmentId}/image/`);
        // A picture this note already holds is not a picture to go and fetch.
        expect(rewritten).toContain(stored);
        expect(asked).toEqual([]);
    });

    /**
     * A distinct address per test. The module keeps one url→attachment map for the life of the
     * process, deliberately — a picture pasted into twenty notes is fetched once — so two tests
     * sharing an address would be two tests sharing a result.
     */
    const freshUrl = () => `https://pictures.test/${++counter}.png`;

    /** Runs `work` with the reader's answer to "may a note fetch what it names" set either way. */
    function withDownloads<T>(allowed: boolean, work: () => T): T {
        const previously = optionService.getOptionBool("downloadImagesAutomatically");
        getContext().init(() => optionService.setOption("downloadImagesAutomatically", String(allowed)));

        try {
            return getContext().init(work);
        } finally {
            getContext().init(() => optionService.setOption("downloadImagesAutomatically", String(previously)));
        }
    }

    it("fetches what a note names elsewhere, and rewrites a later save from what it kept", async () => {
        const note = createNote("<p>x</p>");
        const url = freshUrl();

        // The fetch is deliberately not waited for: a save happens on every keystroke's pause, and
        // a third party's server is not something to hold one up. So the content comes back naming
        // the address it named before.
        expect(withDownloads(true, () => downloadImages(note.noteId, `<p><img src="${url}"></p>`))).toContain(url);

        await vi.waitFor(() => expect(note.getAttachments()).toHaveLength(1));
        expect(asked).toEqual([ url ]);

        // The next save of the same address is answered from what was kept, without asking again —
        // which is the whole point of remembering it.
        const [ attachment ] = note.getAttachments();
        const later = withDownloads(true, () => downloadImages(note.noteId, `<p><img src="${url}"></p>`));

        expect(later).toContain(`src="api/attachments/${attachment.attachmentId}/image/`);
        expect(asked).toEqual([ url ]);

        // And when what was kept has since been erased, the note is left naming the address rather
        // than pointed at an attachment that is not there.
        getContext().init(() => attachment.markAsDeleted());
        expect(withDownloads(true, () => downloadImages(note.noteId, `<p><img src="${url}"></p>`))).toContain(url);
    });

    it("asks for nothing at all when the reader has said not to fetch", async () => {
        const note = createNote("<p>x</p>");
        const url = freshUrl();

        expect(withDownloads(false, () => downloadImages(note.noteId, `<p><img src="${url}"></p>`))).toContain(url);

        await settle();
        expect(asked).toEqual([]);
        expect(note.getAttachments()).toHaveLength(0);
    });

    it("refuses an address that is not a website, whatever the content says", async () => {
        // The content is whatever was pasted, imported or synced, so the scheme is checked here and
        // not taken on trust: `file://` would otherwise have the server read its own disk.
        const note = createNote("<p>x</p>");

        withDownloads(true, () => downloadImages(note.noteId, `<p><img src="file:///etc/passwd"></p>`));

        await settle();
        expect(asked).toEqual([]);
        expect(note.getAttachments()).toHaveLength(0);
    });

    it("leaves alone what is already ours, and what the clipper is still to resolve", async () => {
        const note = createNote("<p>x</p>");
        // An image note's own address, an attachment's, and the web clipper's 20-character id —
        // none of them a third party's, so none of them anything to go and fetch.
        const content = `<p><img src="api/images/abc123456789/x.png">`
            + `<img src="api/attachments/abc123456789/image/y.png">`
            + `<img src="12345678901234567890"></p>`;

        expect(withDownloads(true, () => downloadImages(note.noteId, content))).toBe(content);

        await settle();
        expect(asked).toEqual([]);
    });

    it("goes back over the note once the pictures it started have arrived", async () => {
        // The flow this exists for: the reader pastes a picture and leaves the note before the
        // fetch finishes, so nothing rewrites the address at save time. A while later the note is
        // read again and mended — or found gone, and left alone.
        vi.useFakeTimers();

        try {
            const url = freshUrl();
            const content = `<p><img src="${url}"></p>`;
            const note = createNote(content);

            withDownloads(true, () => downloadImages(note.noteId, content));

            // Long enough for the fetch to have answered and the pass over the note to have run.
            await vi.advanceTimersByTimeAsync(10_000);

            const [ attachment ] = note.getAttachments();
            // The reader is left with a note that names what this instance holds rather than what
            // someone else's server does — without their having saved again to get it.
            expect(String(note.getContent()))
                .toBe(`<p><img src="api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}"></p>`);
        } finally {
            vi.useRealTimers();
        }
    });

    it("asks once for an address that appears twice before the first answer arrives", async () => {
        const note = createNote("<p>x</p>");
        const url = freshUrl();

        // Two saves in quick succession, which is what typing produces. The second finds the first
        // still in flight: neither the map nor the note has the picture yet.
        withDownloads(true, () => {
            downloadImages(note.noteId, `<p><img src="${url}"></p>`);
            downloadImages(note.noteId, `<p><img src="${url}"></p>`);
        });

        await vi.waitFor(() => expect(note.getAttachments()).toHaveLength(1));
        expect(asked).toEqual([ url ]);
    });
});

describe("storeLinkPreviewPictures (real DB)", () => {
    it("stores each as an attachment and points the card at it", async () => {
        // What a Notion export leaves behind: the origin's addresses and no bytes, which the render
        // sinks refuse outright — so until they are fetched the card shows placeholders.
        const note = createNote(card("https://example.com/page", "https://example.com/favicon.png", "https://cdn.example.com/cover.png"));

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(asked).toEqual([ "https://example.com/favicon.png", "https://cdn.example.com/cover.png" ]);

        // Roled and named exactly as a preview fetched here would be.
        const attachments = note.getAttachments();
        expect(attachments.map((a) => [ a.role, a.title ]).sort()).toStrictEqual([
            [ "coverImage", expect.stringMatching(/^example\.com-page-[0-9a-f]{8}\.png$/) ],
            [ "favicon", "example.com.png" ]
        ]);

        const content = String(note.getContent());
        expect(content).not.toContain("https://example.com/favicon.png");
        expect(content).not.toContain("https://cdn.example.com/cover.png");
        for (const attachment of attachments) {
            expect(content).toContain(`api/attachments/${attachment.attachmentId}/image/`);
        }
    });

    it("keeps one icon for a site named by more than one card", async () => {
        const note = createNote(
            card("https://example.com/a", "https://example.com/favicon.png")
            + card("https://example.com/b", "https://example.com/favicon.png")
        );

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments().map((a) => a.title)).toStrictEqual([ "example.com.png" ]);
    });

    it("asks for nothing when the setting says not to", async () => {
        // The same setting that decides whether a remote <img> in note content is fetched.
        const note = createNote(card("https://example.com/page", "https://example.com/favicon.png"));
        const previously = optionService.getOptionBool("downloadImagesAutomatically");
        getContext().init(() => optionService.setOption("downloadImagesAutomatically", "false"));

        try {
            await getContext().init(() => storeLinkPreviewPictures(note));
        } finally {
            getContext().init(() => optionService.setOption("downloadImagesAutomatically", String(previously)));
        }

        expect(asked).toEqual([]);
        expect(note.getAttachments()).toHaveLength(0);
        // Left as it was: nothing was fetched, so nothing is rewritten.
        expect(String(note.getContent())).toContain("https://example.com/favicon.png");
    });

    it("leaves a picture that is already an attachment alone", async () => {
        // A preview made here, or one already stored: nothing left to do and nobody to ask.
        const note = createNote(card("https://example.com/page", "api/attachments/att1/image/example.com.ico"));

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(asked).toEqual([]);
        expect(note.getAttachments()).toHaveLength(0);
        expect(String(note.getContent())).toContain(`data-favicon="api/attachments/att1/image/example.com.ico"`);
    });

    it("lifts a picture carried inline out into an attachment", async () => {
        // Our own single-file export inlines both pictures as base64, having nowhere else to put them,
        // and every preview made before the pictures became attachments carried them the same way.
        // Left inline they cost a third more than the bytes they encode, in every revision of the note.
        const note = createNote(card(
            "https://example.com/page",
            `data:image/svg+xml;base64,${btoa(TINY_SVG)}`,
            `data:image/png;base64,${PIXEL_PNG.toString("base64")}`
        ));

        await getContext().init(() => storeLinkPreviewPictures(note));

        // Nothing was fetched — the bytes were already here — and both are roled and named exactly as
        // a preview made here would have stored them.
        expect(asked).toEqual([]);
        const attachments = note.getAttachments();
        expect(attachments.map((a) => [ a.role, a.title ]).sort()).toStrictEqual([
            [ "coverImage", expect.stringMatching(/^example\.com-page-[0-9a-f]{8}\.png$/) ],
            [ "favicon", "example.com.svg" ]
        ]);

        const content = String(note.getContent());
        expect(content).not.toContain("base64");
        for (const attachment of attachments) {
            expect(content).toContain(`api/attachments/${attachment.attachmentId}/image/`);
        }
    });

    it("lifts an inline picture whatever the setting says, having nobody to ask", async () => {
        // `downloadImagesAutomatically` governs reaching out to a third party on the reader's behalf.
        // Unpacking bytes the note already carries asks nothing of anyone, so the setting has no say —
        // and gating it there would leave the base64 in place for anyone who had turned it off.
        const note = createNote(card("https://example.com/page", `data:image/png;base64,${PIXEL_PNG.toString("base64")}`));
        const previously = optionService.getOptionBool("downloadImagesAutomatically");
        getContext().init(() => optionService.setOption("downloadImagesAutomatically", "false"));

        try {
            await getContext().init(() => storeLinkPreviewPictures(note));
        } finally {
            getContext().init(() => optionService.setOption("downloadImagesAutomatically", String(previously)));
        }

        expect(note.getAttachments().map((a) => a.title)).toStrictEqual([ "example.com.png" ]);
        expect(String(note.getContent())).not.toContain("base64");
    });

    it("keeps one icon when the same inline picture repeats across cards", async () => {
        // The saving that makes this worth doing: a site linked a dozen times inlines its icon a
        // dozen times, and a deduplicated role keys on the title, so those dozen become one.
        const icon = `data:image/png;base64,${PIXEL_PNG.toString("base64")}`;
        const note = createNote(
            card("https://example.com/a", icon) + card("https://example.com/b", icon)
        );

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments().map((a) => a.title)).toStrictEqual([ "example.com.png" ]);
    });

    it("leaves an inline value alone when it is not a picture at all", async () => {
        // The bytes are asked what they are rather than the `data:` prefix being taken for it.
        const note = createNote(card("https://example.com/page", "data:image/png;base64,AAAA"));

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments()).toHaveLength(0);
        expect(String(note.getContent())).toContain(`data-favicon="data:image/png;base64,AAAA"`);
    });

    it("drops nothing and keeps going when a picture cannot be had", async () => {
        // One address answers, the other does not: the card that can be completed is, and the one
        // that cannot keeps what it had rather than the note failing to save.
        const note = createNote(card("https://example.com/page", "https://example.com/favicon.png", "https://cdn.example.com/gone.png"));
        answerWith = (url) => (url.includes("gone") ? undefined : PIXEL_PNG);

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments().map((a) => a.role)).toStrictEqual([ "favicon" ]);
        expect(String(note.getContent())).toContain(`data-image="https://cdn.example.com/gone.png"`);
    });
});
