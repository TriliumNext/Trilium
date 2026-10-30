import http from "node:http";

import { becca, cls, getSql } from "@triliumnext/core";
import imageService from "@triliumnext/core/src/services/image.js";
import { initShare, shaca } from "@triliumnext/core/src/share/index.js";
import { getShareProvider } from "@triliumnext/core/src/share/share_provider.js";
import supertest from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type ApiTestContext, bootLoggedInApp } from "../../spec/support/internal_api.js";

// The fixture's "Shared notes" root and its "Child note", a text note; "Password protected share"
// carries #shareCredentials and "Shared Note Template" is a code note.
const ROOT = "y0AFOwgOgkWO";
const NOTE = "bKMn5EFv9KS2";
const LOCKED = "YjlPRj2E9fOV";
const CODE = "HAWgHNXXdzin";

const SESSION = `/share/api/edit/session?noteId=${NOTE}`;
const DATA = `/share/api/notes/${NOTE}/data`;

describe("share edit API", () => {
    let host: ApiTestContext;

    beforeAll(async () => {
        host = await bootLoggedInApp();
        // The share's read-only connection reads the fixture file under test, where the main
        // connection is in memory: shaca reads the main one here, so it sees the host's changes.
        const sql = getSql();
        initShare({
            ...getShareProvider(),
            sql: {
                getRawRows: <T>(query: string, params?: string[]) => sql.getRawRows(query, params) as T[],
                getRow: <T>(query: string, params?: string[]) => sql.getRow<T>(query, params),
                getColumn: <T>(query: string, params?: string[]) => sql.getColumn<T>(query, params)
            }
        });
        shaca.reset();
    });

    function setShareEdit(body: Record<string, unknown>) {
        return host.agent.put(`/api/notes/${ROOT}/share-edit`).set("x-csrf-token", host.csrfToken).send(body);
    }

    it("offers no editing until the host opens the subtree, with a password or openly", async () => {
        const guest = supertest.agent(host.app);
        await guest.get(SESSION).expect(200, { editable: false });
        await guest.get("/share/api/edit/session?noteId=nope").expect(404);
        await guest.get("/share/api/edit/session").expect(404);

        await setShareEdit({ enabled: true }).expect(400);
        await setShareEdit({ enabled: true, password: "abc" }).expect(400);
        // The labels land inside a transaction, whose commit sends them to the host's open
        // clients; the route is asynchronous, so no wrapper opens one for it.
        const sql = getSql();
        const runTransaction = sql.transactional.bind(sql);
        let writtenInTransaction = false;
        const transactional = vi.spyOn(sql, "transactional").mockImplementation((fn) => {
            const before = becca.getNoteOrThrow(ROOT).hasOwnedLabel("shareEdit");
            const result = runTransaction(fn);
            const after = becca.getNoteOrThrow(ROOT).hasOwnedLabel("shareEdit");
            writtenInTransaction ||= !before && after;
            return result;
        });
        await setShareEdit({ enabled: true, password: "secret1", attachments: false })
            .expect(200, { enabled: true, needsPassword: true, attachments: false });
        transactional.mockRestore();
        expect(writtenInTransaction).toBe(true);

        const session = await guest.get(SESSION).expect(200);
        expect(session.body).toMatchObject({
            editable: true, needsPassword: true, unlocked: false, rootNoteId: ROOT, attachments: false
        });
        expect(session.body.csrfToken).toBeUndefined();
        expect(session.body.strings.edit).toBeTruthy();

        // A code note is never edited by guests; a credential-protected note is not found without them.
        await guest.get(`/share/api/edit/session?noteId=${CODE}`).expect(200, { editable: false });
        await guest.get(`/share/api/edit/session?noteId=${LOCKED}`).expect(404);
        // The host's own session is unlocked without the password.
        const hostSession = await host.agent.get(SESSION).expect(200);
        expect(hostSession.body.unlocked).toBe(true);
        expect(hostSession.body.csrfToken).toBeTruthy();
    });

    it("unlocks with the password, saves with a CSRF token, refuses a stale save and logs out", async () => {
        const guest = supertest.agent(host.app);
        await guest.post("/share/api/edit/login").send({ noteId: NOTE, password: "wrong" }).expect(401);
        await guest.post("/share/api/edit/login").send({ noteId: NOTE }).expect(401);
        await guest.post("/share/api/edit/login").send({ noteId: CODE, password: "secret1" }).expect(403);
        await guest.put(DATA).send({ content: "<p>x</p>" }).expect(403);

        const login = await guest.post("/share/api/edit/login").send({ noteId: NOTE, password: "secret1" }).expect(200);
        const { csrfToken, version, payload } = login.body;
        expect(csrfToken).toBeTruthy();
        expect(version).toBe(becca.getNoteOrThrow(NOTE).blobId);
        // The editor starts from the content of that version, not from one fetched later.
        expect(payload.blobs).toEqual({ [NOTE]: expect.objectContaining({
            blobId: version, content: becca.getNoteOrThrow(NOTE).getContent()
        }) });
        expect(payload.notes.map((note: { noteId: string }) => note.noteId)).toEqual([ NOTE ]);
        expect(payload.options.textNoteEditorType).toBe("ckeditor-classic");
        expect(payload.assetPath).toMatch(/^\.\.\/assets\//);
        const session = await guest.get(SESSION).expect(200);
        expect(session.body.unlocked).toBe(true);
        expect(session.body.csrfToken).toBeTruthy();
        // An unlocked session opens the editor again without the password.
        const again = await guest.post("/share/api/edit/login").send({ noteId: NOTE }).expect(200);
        expect(again.body.csrfToken).toBeTruthy();

        const saved = await guest.put(DATA).set("x-csrf-token", csrfToken)
            .send({ content: "<p>Guest <script>alert(1)</script></p>", baseBlobId: version }).expect(200);
        expect(saved.body.blobId).not.toBe(version);
        const content = String(becca.getNoteOrThrow(NOTE).getContent());
        expect(content).toContain("<p>Guest ");
        expect(content).not.toContain("<script");

        const stale = await guest.put(DATA).set("x-csrf-token", csrfToken)
            .send({ content: "<p>Again</p>", baseBlobId: version }).expect(409);
        expect(stale.body.stale).toEqual({ blobId: saved.body.blobId });
        await guest.put(DATA).set("x-csrf-token", csrfToken).send({ content: 5 }).expect(400);
        await guest.put(DATA).set("x-csrf-token", csrfToken)
            .send({ content: "x".repeat(2 * 1024 * 1024 + 1) }).expect(413);

        await guest.put(`/share/api/notes/${NOTE}/title`).set("x-csrf-token", csrfToken)
            .send({ title: " Renamed by a guest " }).expect(200, { title: "Renamed by a guest" });
        await guest.put(`/share/api/notes/${NOTE}/title`).set("x-csrf-token", csrfToken)
            .send({ title: 5 }).expect(400);
        await guest.post(`/share/api/notes/${NOTE}/attachments/upload`).set("x-csrf-token", csrfToken)
            .attach("upload", Buffer.from("notes"), "notes.txt").expect(403);

        await guest.post("/share/api/edit/logout").set("x-csrf-token", csrfToken).send({ noteId: NOTE }).expect(204);
        await guest.put(DATA).set("x-csrf-token", csrfToken).send({ content: "<p>x</p>" }).expect(401);
    });

    it("ends the grants of a replaced password, a reopened subtree and open editing", async () => {
        const guest = supertest.agent(host.app);
        const rename = (csrfToken: string) => guest.put(`/share/api/notes/${NOTE}/title`)
            .set("x-csrf-token", csrfToken).send({ title: "Child note" });
        const login = (password?: string) =>
            guest.post("/share/api/edit/login").send({ noteId: NOTE, password });
        const first = (await login("secret1").expect(200)).body;
        await rename(first.csrfToken).expect(200);

        await setShareEdit({ enabled: true, password: "secret2" }).expect(200);
        expect((await guest.get(SESSION).expect(200)).body.unlocked).toBe(false);
        // The refusal says so, for the page to ask for the password again.
        expect((await rename(first.csrfToken).expect(401)).body.locked).toBe(true);
        await login().expect(401);
        await login("secret1").expect(401);
        const second = (await login("secret2").expect(200)).body;
        await rename(second.csrfToken).expect(200);

        // The same password set again has a new salt, so it ends the grant as well.
        await setShareEdit({ enabled: false }).expect(200);
        await setShareEdit({ enabled: true, password: "secret2" }).expect(200);
        await rename(second.csrfToken).expect(401);

        // A grant of open editing ends once the subtree takes a password.
        await setShareEdit({ enabled: true, open: true }).expect(200);
        const open = (await login().expect(200)).body;
        await rename(open.csrfToken).expect(200);
        await setShareEdit({ enabled: true, password: "secret1" }).expect(200);
        await rename(open.csrfToken).expect(401);
    });

    it("stores an upload once attachments are allowed, and an open subtree needs no password", async () => {
        await setShareEdit({ enabled: true, open: true, attachments: true })
            .expect(200, { enabled: true, needsPassword: false, attachments: true });
        const guest = supertest.agent(host.app);
        const session = await guest.get(SESSION).expect(200);
        expect(session.body).toMatchObject({ needsPassword: false, unlocked: false, attachments: true });

        const { csrfToken } = (await guest.post("/share/api/edit/login").send({ noteId: NOTE }).expect(200)).body;
        const upload = await guest.post(`/share/api/notes/${NOTE}/attachments/upload`)
            .set("x-csrf-token", csrfToken).attach("upload", Buffer.from("notes"), "notes.txt").expect(200);
        const attachmentId = becca.getNoteOrThrow(NOTE).getAttachments()
            .find((candidate) => candidate.title === "notes.txt")?.attachmentId;
        // The link the app's own upload answers; the share renders it as its download.
        const url = `#root/${NOTE}?viewMode=attachments&attachmentId=${attachmentId}`;
        expect(upload.body).toEqual({ uploaded: true, url });
        const link = `<p><a class="reference-link" href="${url}">notes.txt</a></p>`;
        await guest.put(DATA).set("x-csrf-token", csrfToken).send({ content: link }).expect(200);
        const page = await guest.get(`/share/${NOTE}`).expect(200);
        expect(page.text).toContain(`href="api/attachments/${attachmentId}/download"`);
        await guest.get(`/share/api/attachments/${attachmentId}/download`).expect(200);
        await guest.post(`/share/api/notes/${NOTE}/attachments/upload`).set("x-csrf-token", csrfToken).expect(400);

        // A read-only note stays as it is, and closing the subtree ends the grant's use.
        cls.init(() => becca.getNoteOrThrow(NOTE).setLabel("readOnly"));
        await guest.put(DATA).set("x-csrf-token", csrfToken).send({ content: "<p>x</p>" }).expect(403);
        await guest.get(SESSION).expect(200, { editable: false });
        cls.init(() => becca.getNoteOrThrow(NOTE).removeLabel("readOnly"));

        await setShareEdit({ enabled: false }).expect(200, { enabled: false });
        await guest.get(SESSION).expect(200, { editable: false });
        await guest.put(DATA).set("x-csrf-token", csrfToken).send({ content: "<p>x</p>" }).expect(403);
        expect(becca.getNoteOrThrow(ROOT).getOwnedAttributes().map((attr) => attr.name)).not.toContain("shareEdit");
    });

    it("writes each upload inside a transaction, whose commit reaches open clients", async () => {
        await setShareEdit({ enabled: true, open: true, attachments: true }).expect(200);
        const guest = supertest.agent(host.app);
        const login = await guest.post("/share/api/edit/login").send({ noteId: NOTE }).expect(200);
        const { csrfToken } = login.body;
        const sql = getSql();
        const transactional = sql.transactional.bind(sql);
        let depth = 0;
        vi.spyOn(sql, "transactional").mockImplementation((func) => {
            depth++;
            try {
                return transactional(func);
            } finally {
                depth--;
            }
        });
        const depths: number[] = [];
        const note = becca.getNoteOrThrow(NOTE);
        const saveAttachment = note.saveAttachment.bind(note);
        vi.spyOn(note, "saveAttachment").mockImplementation((...args) => {
            depths.push(depth);
            return saveAttachment(...args);
        });
        const saveImage = imageService.saveImageToAttachment.bind(imageService);
        vi.spyOn(imageService, "saveImageToAttachment").mockImplementation((...args) => {
            depths.push(depth);
            return saveImage(...args);
        });
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
            + "DwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

        const upload = () => guest.post(`/share/api/notes/${NOTE}/attachments/upload`)
            .set("x-csrf-token", csrfToken);

        try {
            await upload().attach("upload", Buffer.from("notes"), "inside.txt").expect(200);
            await upload()
                .attach("upload", png, { filename: "inside.png", contentType: "image/png" })
                .expect(200);
            expect(depths.length).toBeGreaterThanOrEqual(2);
            expect(depths).not.toContain(0);
        } finally {
            vi.restoreAllMocks();
            await setShareEdit({ enabled: false }).expect(200);
        }
    });

    it("refuses an upload whose permission ended while its file was still arriving", async () => {
        await setShareEdit({ enabled: true, open: true, attachments: true }).expect(200);
        const server = host.app.listen(0);
        try {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            const login = await fetch(`http://127.0.0.1:${port}/share/api/edit/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ noteId: NOTE })
            });
            const cookie = login.headers.getSetCookie()
                .map((header) => header.split(";")[0]).join("; ");
            const { csrfToken } = await login.json() as { csrfToken: string };

            const boundary = "guest-upload";
            const head = `--${boundary}\r\n`
                + "Content-Disposition: form-data; name=\"upload\"; filename=\"late.txt\"\r\n"
                + "Content-Type: text/plain\r\n\r\n";
            const tail = `late\r\n--${boundary}--\r\n`;
            const status = await new Promise<number>((resolve, reject) => {
                const request = http.request({
                    host: "127.0.0.1",
                    port,
                    method: "POST",
                    path: `/share/api/notes/${NOTE}/attachments/upload`,
                    headers: {
                        cookie,
                        "x-csrf-token": csrfToken,
                        "content-type": `multipart/form-data; boundary=${boundary}`
                    }
                }, (response) => {
                    response.resume();
                    response.on("end", () => resolve(response.statusCode ?? 0));
                });
                request.on("error", reject);
                request.write(head);
                // The access check ran on the headers; attachments close before the file ends.
                setTimeout(() => {
                    setShareEdit({ enabled: true, open: true, attachments: false })
                        .then(() => request.end(tail), reject);
                }, 100);
            });
            expect(status).toBe(403);
            expect(becca.getNoteOrThrow(NOTE).getAttachments().map((candidate) => candidate.title))
                .not.toContain("late.txt");
        } finally {
            await new Promise((resolve) => server.close(resolve));
            await setShareEdit({ enabled: false }).expect(200);
        }
    });

    it("overrides what a note inherits for its branch, and hands the branch back", async () => {
        const setChild = (body: Record<string, unknown>) => host.agent
            .put(`/api/notes/${NOTE}/share-edit`).set("x-csrf-token", host.csrfToken).send(body);
        const guest = supertest.agent(host.app);
        const session = async () => (await guest.get(SESSION).expect(200)).body;
        const editLabels = [ "shareEdit", "shareEditPassword", "shareAttachments" ];
        const owned = (noteId: string) => Object.fromEntries(becca.getNoteOrThrow(noteId)
            .getOwnedAttributes()
            .filter((attr) => attr.type === "label" && editLabels.includes(attr.name))
            .map((label) => [ label.name, label.value ]));
        const locked = { enabled: true, needsPassword: true };
        const open = { enabled: true, needsPassword: false };

        await setShareEdit({ enabled: true, password: "secret1", attachments: false }).expect(200);
        expect(await session())
            .toMatchObject({ editable: true, rootNoteId: ROOT, needsPassword: true });

        // Off on the child closes its branch only; on again gives the branch back to its ancestor.
        await setChild({ enabled: false }).expect(200, { enabled: false });
        expect(owned(NOTE)).toEqual({ shareEdit: "false" });
        expect(await session()).toEqual({ editable: false });
        expect(becca.getNoteOrThrow(ROOT).isLabelTruthy("shareEdit")).toBe(true);
        await setChild({ enabled: true }).expect(200, { ...locked, attachments: false });
        expect(owned(NOTE)).toEqual({});
        expect(await session()).toMatchObject({ editable: true, rootNoteId: ROOT });

        // Attachments are set on the child where they differ from what it inherits.
        await setChild({ enabled: true, attachments: true })
            .expect(200, { ...locked, attachments: true });
        expect(owned(NOTE)).toEqual({ shareAttachments: "" });
        await setShareEdit({ enabled: true, attachments: true }).expect(200);
        await setChild({ enabled: true, attachments: false })
            .expect(200, { ...locked, attachments: false });
        expect(owned(NOTE)).toEqual({ shareAttachments: "false" });
        await setShareEdit({ enabled: true, attachments: false }).expect(200);
        await setChild({ enabled: true, attachments: false })
            .expect(200, { ...locked, attachments: false });
        expect(owned(NOTE)).toEqual({});

        // Open editing or a password makes the child the root of a branch of its own.
        await setChild({ enabled: true, open: true }).expect(200, { ...open, attachments: false });
        expect(owned(NOTE)).toEqual({ shareEdit: "", shareEditPassword: "" });
        expect(await session())
            .toMatchObject({ editable: true, rootNoteId: NOTE, needsPassword: false });
        await setChild({ enabled: true, password: "branch1" })
            .expect(200, { ...locked, attachments: false });
        expect(await session()).toMatchObject({ rootNoteId: NOTE, needsPassword: true });
        await guest.post("/share/api/edit/login")
            .send({ noteId: NOTE, password: "branch1" }).expect(200);

        // Without an ancestor to fall back on, off removes the labels and on needs a password.
        await setShareEdit({ enabled: false }).expect(200);
        expect(owned(ROOT)).toEqual({});
        await setChild({ enabled: false }).expect(200);
        expect(owned(NOTE)).toEqual({});
        await setChild({ enabled: true }).expect(400);
        await setChild({ enabled: true, attachments: true }).expect(400);
        expect(owned(NOTE)).toEqual({});
    });

    it("renews, for a logout, the token of a session replaced by another unlock", async () => {
        const setChild = (body: Record<string, unknown>) => host.agent
            .put(`/api/notes/${NOTE}/share-edit`).set("x-csrf-token", host.csrfToken).send(body);
        const guest = supertest.agent(host.app);
        const session = async (noteId: string) =>
            (await guest.get(`/share/api/edit/session?noteId=${noteId}`).expect(200)).body;
        const logout = (noteId: string, csrfToken: string) => guest.post("/share/api/edit/logout")
            .set("x-csrf-token", csrfToken).send({ noteId });
        await setShareEdit({ enabled: true, password: "secret1" }).expect(200);
        await setChild({ enabled: true, password: "branch1" }).expect(200);

        const first = await guest.post("/share/api/edit/login")
            .send({ noteId: ROOT, password: "secret1" }).expect(200);
        await guest.post("/share/api/edit/login")
            .send({ noteId: NOTE, password: "branch1" }).expect(200);
        await logout(ROOT, first.body.csrfToken).expect(403);

        const renewed = await session(ROOT);
        expect(renewed.unlocked).toBe(true);
        await logout(ROOT, renewed.csrfToken).expect(204);
        expect(await session(ROOT)).toMatchObject({ unlocked: false });
        expect(await session(ROOT)).not.toHaveProperty("csrfToken");
        expect(await session(NOTE)).toMatchObject({ unlocked: true });

        await setShareEdit({ enabled: false }).expect(200);
        await setChild({ enabled: false }).expect(200);
    });
});
