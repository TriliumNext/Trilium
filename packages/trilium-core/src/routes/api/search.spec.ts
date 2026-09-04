import { dayjs, type TemplatesResponse } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";
import { isNewTemplate } from "./search";

let api: CoreApiTester;
const UNIQUE_TOKEN = "ZzUniqueSearchTokenQwerty";

describe("Search API (core)", () => {
    let createdNoteId: string;

    beforeAll(async () => {
        api = CoreApiTester.build();
        ({ noteId: createdNoteId } = await createTextNote(api, { title: UNIQUE_TOKEN }));
    });

    it("returns matching note ids for a full search", async () => {
        const res = await api.get<string[]>(`/api/search/${UNIQUE_TOKEN}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toContain(createdNoteId);
    });

    it("returns structured quick-search results with snippets", async () => {
        const res = await api.get<{ searchResultNoteIds: string[]; searchResults: unknown[] }>(
            `/api/quick-search/${UNIQUE_TOKEN}`
        );
        expect(res.status).toBe(200);
        expect(res.body.searchResultNoteIds).toContain(createdNoteId);
        expect(Array.isArray(res.body.searchResults)).toBe(true);
    });

    it("scopes quick-search results to the hoisted subtree when hoistedNoteId is supplied", async () => {
        // Create a workspace root and a note inside it that matches the unique token.
        const { noteId: workspaceId } = await createTextNote(api, { title: "Workspace root" });
        const SCOPED_TOKEN = "ZzScopedSearchTokenQwerty";
        const { noteId: insideId } = await createTextNote(api, { parentNoteId: workspaceId, title: SCOPED_TOKEN });

        // A note with the same token that lives outside the workspace.
        const { noteId: outsideId } = await createTextNote(api, { title: SCOPED_TOKEN });

        // Search scoped to the workspace — only the note inside must appear.
        const scoped = await api.get<{ searchResultNoteIds: string[] }>(
            `/api/quick-search/${SCOPED_TOKEN}?hoistedNoteId=${workspaceId}`
        );
        expect(scoped.status).toBe(200);
        expect(scoped.body.searchResultNoteIds).toContain(insideId);
        expect(scoped.body.searchResultNoteIds).not.toContain(outsideId);

        // Without hoistedNoteId both notes must appear (unscoped fallback).
        const unscoped = await api.get<{ searchResultNoteIds: string[] }>(
            `/api/quick-search/${SCOPED_TOKEN}`
        );
        expect(unscoped.status).toBe(200);
        expect(unscoped.body.searchResultNoteIds).toContain(insideId);
        expect(unscoped.body.searchResultNoteIds).toContain(outsideId);
    });

    it("lists template note ids including a freshly-labelled template", async () => {
        const { noteId } = await createTextNote(api, { title: "A template note" });
        await api.post(`/api/notes/${noteId}/attributes`, {
            body: { type: "label", name: "template", value: "" }
        });

        const res = await api.get<TemplatesResponse>("/api/search-templates");
        expect(res.status).toBe(200);
        expect(res.body.templateNoteIds).toContain(noteId);
        expect(Array.isArray(res.body.newTemplateNoteIds)).toBe(true);
    });

    it("400s when searching from a note that is not a search note", async () => {
        const res = await api.get("/api/search-note/root");
        expect(res.status).toBe(400);
    });

    it("returns related notes for an attribute query", async () => {
        const res = await api.post<{ count: number; results: unknown[] }>("/api/search-related", {
            body: { type: "label", name: "docName", value: "hidden" }
        });
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe("number");
        expect(Array.isArray(res.body.results)).toBe(true);
    });

    it("caps related-note results at 20 even with many matches", async () => {
        // Create more than 20 notes carrying the same label so the result loop
        // hits its >= 20 break.
        for (let i = 0; i < 22; i++) {
            const { noteId } = await createTextNote(api, { title: `Related ${i}` });
            await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name: "relTestLabel", value: "relTestValue" }
            });
        }

        const res = await api.post<{ count: number; results: unknown[] }>("/api/search-related", {
            body: { type: "label", name: "relTestLabel", value: "relTestValue" }
        });
        expect(res.status).toBe(200);
        expect(res.body.count).toBeGreaterThanOrEqual(22);
        expect(res.body.results).toHaveLength(20);
    });

    it("runs a saved search note and executes bulk actions over it", async () => {
        const created = await api.post<{ noteId: string; type: string }>(
            "/api/special-notes/search-note",
            { body: { searchString: UNIQUE_TOKEN } }
        );
        expect(created.body.type).toBe("search");
        const searchNoteId = created.body.noteId;

        const fromNote = await api.get<{ searchResultNoteIds: string[] }>(
            `/api/search-note/${searchNoteId}`
        );
        expect(fromNote.status).toBe(200);
        expect(fromNote.body.searchResultNoteIds).toContain(createdNoteId);

        // searchAndExecute returns no body (204) — the note has no action labels,
        // so executing over the results is a safe no-op.
        const exec = await api.post(`/api/search-and-execute-note/${searchNoteId}`);
        expect(exec.status).toBe(204);
    });

    it("400s when executing a note that is not a search note", async () => {
        const res = await api.post("/api/search-and-execute-note/root");
        expect(res.status).toBe(400);
    });
});

describe("isNewTemplate", () => {
    const ROOT_CREATED = "2026-01-01 00:00:00.000Z";
    const utc = (date: dayjs.Dayjs) => date.format("YYYY-MM-DD HH:mm:ss.SSS[Z]");

    it("marks recent templates as new and leaves older ones alone", () => {
        expect(isNewTemplate(utc(dayjs.utc().subtract(1, "day")), ROOT_CREATED)).toBe(true);
        expect(isNewTemplate(utc(dayjs.utc().subtract(4, "day")), ROOT_CREATED)).toBe(false);
        expect(isNewTemplate(null, ROOT_CREATED)).toBe(false);
    });

    it("never marks the predefined templates set up alongside the root note", () => {
        const root = dayjs.utc().subtract(1, "hour");
        // Created together with the database: within the grace period, so not new
        // despite being only an hour old.
        expect(isNewTemplate(utc(root.add(10, "second")), utc(root))).toBe(false);
        // Added later on, e.g. by an upgrade.
        expect(isNewTemplate(utc(root.add(1, "minute")), utc(root))).toBe(true);
    });

    it("falls back to the age check when the root creation date is unknown", () => {
        expect(isNewTemplate(utc(dayjs.utc()), null)).toBe(true);
        expect(isNewTemplate(utc(dayjs.utc().subtract(4, "day")), undefined)).toBe(false);
    });
});
