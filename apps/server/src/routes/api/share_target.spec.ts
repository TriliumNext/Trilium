import { becca, type BNote, cls, date_utils as dateUtils, special_notes as specialNotes } from "@triliumnext/core";
import type { Application } from "express";
import { readdirSync } from "fs";
import { join } from "path";
import supertest from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { refreshAuth } from "../../services/auth.js";
import config from "../../services/config.js";
import dataDirs from "../../services/data_dir.js";
import { buildBody, deriveTitle, getOptionalString, needsContainerNote } from "./share_target.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAYAAADESFVDAAAAF0lEQVQoU2P8DwQMBADjqKLRIGAgKggAzHs/0SoYCGwAAAAASUVORK5CYII=", "base64");

let app: Application;
let agent: ReturnType<typeof supertest.agent>;
let maxSharedFiles: number;

/** Resolves the `./#root/…/noteId` redirect to the note it opens. */
function redirectedNote(location: string | undefined): BNote {
    expect(location).toMatch(/^\.\/#root\//);
    const noteId = location?.split("/").pop() ?? "";
    return becca.getNoteOrThrow(noteId);
}

/** Waits until the temp files of the request `send` makes are gone, ignoring those of other specs. */
async function expectTempFilesRemoved(send: () => PromiseLike<unknown>) {
    const tempUploads = () => readdirSync(join(dataDirs.TMP_DIR, "upload"));
    const before = new Set(tempUploads());
    await send();
    await vi.waitFor(() => expect(tempUploads().filter((name) => !before.has(name))).toEqual([]));
}

describe("POST /share-target", () => {
    beforeAll(async () => {
        const buildApp = (await import("../../app.js")).default;
        app = await buildApp();
        config.General.noAuthentication = false;
        refreshAuth();
        agent = supertest.agent(app);
        // Imported here, after the test setup: `route_api.js` needs crypto at load time.
        maxSharedFiles = (await import("../route_api.js")).MAX_SHARED_FILES;
        await agent.post("/login").send({ password: "demo1234" }).expect(302);
    });

    it("refuses a request without a session and creates nothing", async () => {
        const notesBefore = Object.keys(becca.notes).length;

        const res = await supertest(app).post("/share-target").field("text", "hello");

        expect(res.status).toBe(401);
        expect(Object.keys(becca.notes)).toHaveLength(notesBefore);
    });

    it("refuses a form posted by another page and accepts the share sheet's navigation", async () => {
        const notesBefore = Object.keys(becca.notes).length;
        for (const site of [ "same-site", "cross-site" ]) {
            const res = await agent.post("/share-target").set("Sec-Fetch-Site", site).field("text", "hello");
            expect(res.status).toBe(403);
        }
        expect(Object.keys(becca.notes)).toHaveLength(notesBefore);

        for (const site of [ "none", "same-origin" ]) {
            await agent.post("/share-target").set("Sec-Fetch-Site", site).field("text", "hello").expect(303);
        }
    });

    it("saves shared text and a url as a text note with a pageUrl label", async () => {
        const res = await agent
            .post("/share-target")
            .field("title", "A page")
            .field("text", "Worth a read")
            .field("url", "https://example.com/a?x=1&y=2")
            .expect(303);

        const note = redirectedNote(res.headers.location);
        expect(note.title).toBe("A page");
        expect(note.type).toBe("text");
        expect(note.getContent()).toBe(`<p>Worth a read</p><p><a href="https://example.com/a?x=1&amp;y=2">https://example.com/a?x=1&amp;y=2</a></p>`);
        expect(note.getLabelValue("pageUrl")).toBe("https://example.com/a?x=1&y=2");
        expect(note.getLabelValue("clipType")).toBe("share");
    });

    it("puts a single file straight into the inbox and removes its temp file", async () => {
        let location: string | undefined;
        await expectTempFilesRemoved(async () => {
            const res = await agent
                .post("/share-target")
                .attach("files", Buffer.from("log line"), { filename: "app.log", contentType: "text/plain" })
                .expect(303);
            location = res.headers.location;
        });

        const note = redirectedNote(location);
        expect(note.type).toBe("file");
        expect(note.title).toBe("app.log");
        expect(note.getLabelValue("originalFileName")).toBe("app.log");
        expect(Buffer.from(note.getContent()).toString("utf-8")).toBe("log line");
        const inbox = cls.init(() => specialNotes.getInboxNote(dateUtils.localNowDate()));
        expect(note.getParentNotes().map((parent) => parent.noteId)).toEqual([ inbox.noteId ]);
    });

    it("saves into a protected inbox unprotected while the protected session is locked", async () => {
        const inbox = cls.init(() => specialNotes.getInboxNote(dateUtils.localNowDate()));
        inbox.isProtected = true;
        try {
            const res = await agent.post("/share-target").field("text", "while locked").expect(303);

            const note = redirectedNote(res.headers.location);
            expect(note.getParentNotes().map((parent) => parent.noteId)).toEqual([ inbox.noteId ]);
            expect(note.isProtected).toBe(false);
            expect(note.getContent()).toBe("<p>while locked</p>");
        } finally {
            inbox.isProtected = false;
        }
    });

    it("accepts Samsung Internet's NUL byte between a CRLF and a boundary delimiter", async () => {
        const boundary = "----MultipartBoundary--eyLOlXbH76aoDXmj8rZPdIY8RnUN0YjNE3TJOXyUwe----";
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nFrom the gallery\r\n\0`),
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="IMG_1.png"\r\nContent-Type: image/png\r\n\r\n`),
            PNG,
            Buffer.from(`\r\n\0--${boundary}--\r\n`)
        ]);

        const res = await agent
            .post("/share-target")
            .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
            .send(body)
            .expect(303);

        const parent = redirectedNote(res.headers.location);
        expect(parent.getContent()).toBe("<p>From the gallery</p>");
        const [ image ] = parent.getChildNotes();
        expect(image?.title).toBe("IMG_1.png");
        expect(image?.mime).toBe("image/png");
    });

    it("groups several files under a parent note, with their images already stored", async () => {
        const res = await agent
            .post("/share-target")
            .attach("files", PNG, { filename: "one.png", contentType: "image/png" })
            .attach("files", Buffer.from("%PDF-1.4"), { filename: "doc.pdf", contentType: "application/pdf" })
            .expect(303);

        const parent = redirectedNote(res.headers.location);
        expect(parent.type).toBe("text");
        expect(parent.title).toBe("Shared content");

        const children = parent.getChildNotes();
        expect(children.map((child) => child.type).sort()).toEqual([ "file", "image" ]);
        const image = children.find((child) => child.type === "image");
        expect(image?.mime).toBe("image/png");
        expect(image?.getContent().length).toBeGreaterThan(0);
        expect(children.map((child) => child.getLabelValue("clipType"))).toEqual([ "share", "share" ]);
    });

    it("answers a 400 to an empty share and to a malformed or oversized multipart body", async () => {
        const empty = await agent.post("/share-target").field("title", "only a title");
        expect(empty.status).toBe(400);

        const nested = await agent.post("/share-target").field("a[b]", "x").field("text", "hi");
        expect(nested.status).toBe(400);
        expect(nested.text).toContain("nested multipart field names are not allowed");

        let tooMany = agent.post("/share-target");
        for (let i = 0; i <= maxSharedFiles; i++) {
            tooMany = tooMany.attach("files", Buffer.from("x"), `f${i}.txt`);
        }
        await expectTempFilesRemoved(async () => {
            const tooManyRes = await tooMany;
            expect(tooManyRes.status).toBe(400);
            expect(tooManyRes.text).toContain("Share rejected");
        });
    });
});

describe("getOptionalString", () => {
    it("returns the value for non-blank strings", () => {
        expect(getOptionalString("hello")).toBe("hello");
        expect(getOptionalString("  padded  ")).toBe("  padded  ");
    });

    it("returns undefined for blanks and non-strings", () => {
        expect(getOptionalString("")).toBeUndefined();
        expect(getOptionalString("   ")).toBeUndefined();
        expect(getOptionalString(undefined)).toBeUndefined();
        expect(getOptionalString(null)).toBeUndefined();
        expect(getOptionalString(42)).toBeUndefined();
    });
});

describe("deriveTitle", () => {
    it("prefers the explicit title, trimmed", () => {
        expect(deriveTitle("  My Title  ", "body")).toBe("My Title");
    });

    it("falls back to the first line of the body", () => {
        expect(deriveTitle(undefined, "first line\nsecond line")).toBe("first line");
        expect(deriveTitle("   ", "first line\r\nsecond")).toBe("first line");
    });

    it("falls back to a placeholder when nothing usable is provided", () => {
        expect(deriveTitle(undefined, undefined)).toBe("Shared content");
        expect(deriveTitle(undefined, "   ")).toBe("Shared content");
        expect(deriveTitle(42, undefined)).toBe("Shared content");
    });

    it("truncates long titles to 80 characters", () => {
        const long = "a".repeat(200);
        expect(deriveTitle(long, undefined)).toHaveLength(80);
        expect(deriveTitle(undefined, long)).toHaveLength(80);
    });
});

describe("buildBody", () => {
    it("escapes HTML in shared text and converts newlines to <br>", () => {
        expect(buildBody("hello <b>world</b>\nsecond", undefined)).toBe(
            "<p>hello &lt;b&gt;world&lt;/b&gt;<br>second</p>"
        );
    });

    it("renders a shared url as an escaped anchor", () => {
        expect(buildBody(undefined, "https://example.com/a?x=1&y=2")).toBe(
            `<p><a href="https://example.com/a?x=1&amp;y=2">https://example.com/a?x=1&amp;y=2</a></p>`
        );
    });

    it("includes both text and url when both are present", () => {
        expect(buildBody("note", "https://example.com")).toBe(
            `<p>note</p><p><a href="https://example.com">https://example.com</a></p>`
        );
    });

    it("returns an empty string when nothing is provided", () => {
        expect(buildBody(undefined, undefined)).toBe("");
    });
});

describe("needsContainerNote", () => {
    it("groups under a parent when text/url is present", () => {
        expect(needsContainerNote(true, 0)).toBe(true);
        expect(needsContainerNote(true, 1)).toBe(true);
        expect(needsContainerNote(true, 5)).toBe(true);
    });

    it("groups under a parent when more than one file is shared", () => {
        expect(needsContainerNote(false, 2)).toBe(true);
        expect(needsContainerNote(false, 10)).toBe(true);
    });

    it("does not create a parent for a single lone file", () => {
        expect(needsContainerNote(false, 1)).toBe(false);
    });

    it("does not create a parent when nothing is shared", () => {
        expect(needsContainerNote(false, 0)).toBe(false);
    });
});
