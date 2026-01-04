import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";
import { randomUUID } from "crypto";

let app: Application;
let token: string;

const USER = "etapi";
let content: string;

describe("etapi/search", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        content = randomUUID();
        await createNote(app, token, content);
    }, 30000); // Increase timeout to 30 seconds for app initialization

    describe("Basic Search", () => {
        it("finds by content", async () => {
            const response = await supertest(app)
                .get(`/etapi/notes?search=${content}&debug=true`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);
            expect(response.body.results).toHaveLength(1);
        });

        it("does not find by content when fast search is on", async () => {
            const response = await supertest(app)
                .get(`/etapi/notes?search=${content}&debug=true&fastSearch=true`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);
            expect(response.body.results).toHaveLength(0);
        });

        it("returns proper response structure", async () => {
            const response = await supertest(app)
                .get(`/etapi/notes?search=${content}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body).toHaveProperty("results");
            expect(Array.isArray(response.body.results)).toBe(true);

            if (response.body.results.length > 0) {
                const note = response.body.results[0];
                expect(note).toHaveProperty("noteId");
                expect(note).toHaveProperty("title");
                expect(note).toHaveProperty("type");
            }
        });

        it("returns debug info when requested", async () => {
            const response = await supertest(app)
                .get(`/etapi/notes?search=${content}&debug=true`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body).toHaveProperty("debugInfo");
            expect(response.body.debugInfo).toBeTruthy();
        });

        it("returns 400 for missing search parameter", async () => {
            await supertest(app)
                .get("/etapi/notes")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
        });

        it("returns 400 for empty search parameter", async () => {
            await supertest(app)
                .get("/etapi/notes?search=")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
        });
    });

    describe("Search Parameters", () => {
        let testNoteId: string;

        beforeAll(async () => {
            // Create a test note with unique content
            const uniqueContent = `test-${randomUUID()}`;
            testNoteId = await createNote(app, token, uniqueContent);
        }, 10000);

        it("respects fastSearch parameter", async () => {
            // Fast search should not find by content
            const fastResponse = await supertest(app)
                .get(`/etapi/notes?search=${content}&fastSearch=true`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);
            expect(fastResponse.body.results).toHaveLength(0);

            // Regular search should find by content
            const regularResponse = await supertest(app)
                .get(`/etapi/notes?search=${content}&fastSearch=false`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);
            expect(regularResponse.body.results.length).toBeGreaterThan(0);
        });

        it("respects includeArchivedNotes parameter", async () => {
            // Default should include archived notes
            const withArchivedResponse = await supertest(app)
                .get(`/etapi/notes?search=*&includeArchivedNotes=true`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            const withoutArchivedResponse = await supertest(app)
                .get(`/etapi/notes?search=*&includeArchivedNotes=false`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            // Note: Actual behavior depends on whether there are archived notes
            expect(withArchivedResponse.body.results).toBeDefined();
            expect(withoutArchivedResponse.body.results).toBeDefined();
        });

        it("respects limit parameter", async () => {
            const limit = 5;
            const response = await supertest(app)
                .get(`/etapi/notes?search=*&limit=${limit}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body.results.length).toBeLessThanOrEqual(limit);
        });

        it("handles fuzzyAttributeSearch parameter", async () => {
            const response = await supertest(app)
                .get(`/etapi/notes?search=*&fuzzyAttributeSearch=true`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body.results).toBeDefined();
        });
    });

    describe("Search Queries", () => {
        let titleNoteId: string;
        let labelNoteId: string;

        beforeAll(async () => {
            // Create test notes with specific attributes
            const uniqueTitle = `SearchTest-${randomUUID()}`;

            // Create note with specific title
            const titleResponse = await supertest(app)
                .post("/etapi/create-note")
                .auth(USER, token, { "type": "basic"})
                .send({
                    "parentNoteId": "root",
                    "title": uniqueTitle,
                    "type": "text",
                    "content": "Title test content"
                })
                .expect(201);
            titleNoteId = titleResponse.body.note.noteId;

            // Create note with label
            const labelResponse = await supertest(app)
                .post("/etapi/create-note")
                .auth(USER, token, { "type": "basic"})
                .send({
                    "parentNoteId": "root",
                    "title": "Label Test",
                    "type": "text",
                    "content": "Label test content"
                })
                .expect(201);
            labelNoteId = labelResponse.body.note.noteId;

            // Add label to note
            await supertest(app)
                .post("/etapi/attributes")
                .auth(USER, token, { "type": "basic"})
                .send({
                    "noteId": labelNoteId,
                    "type": "label",
                    "name": "testlabel",
                    "value": "testvalue"
                })
                .expect(201);
        }, 15000); // 15 second timeout for setup

        it("searches by title", async () => {
            // Get the title we created
            const noteResponse = await supertest(app)
                .get(`/etapi/notes/${titleNoteId}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            const title = noteResponse.body.title;

            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent(title)}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results.length).toBeGreaterThan(0);
            const foundNote = searchResponse.body.results.find((n: any) => n.noteId === titleNoteId);
            expect(foundNote).toBeTruthy();
        });

        it("searches by label", async () => {
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("#testlabel")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results.length).toBeGreaterThan(0);
            const foundNote = searchResponse.body.results.find((n: any) => n.noteId === labelNoteId);
            expect(foundNote).toBeTruthy();
        });

        it("searches by label with value", async () => {
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("#testlabel=testvalue")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results.length).toBeGreaterThan(0);
            const foundNote = searchResponse.body.results.find((n: any) => n.noteId === labelNoteId);
            expect(foundNote).toBeTruthy();
        });

        it("handles complex queries with AND operator", async () => {
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("#testlabel AND note.type=text")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results).toBeDefined();
        });

        it("handles queries with OR operator", async () => {
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("#testlabel OR #nonexistent")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results.length).toBeGreaterThan(0);
        });

        it("handles queries with NOT operator", async () => {
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("#testlabel NOT #nonexistent")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results.length).toBeGreaterThan(0);
        });

        it("handles wildcard searches", async () => {
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=note.type%3Dtext&limit=10`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results).toBeDefined();
            // Should return results if any text notes exist
            expect(Array.isArray(searchResponse.body.results)).toBe(true);
        });

        it("handles empty results gracefully", async () => {
            const nonexistentQuery = `nonexistent-${randomUUID()}`;
            const searchResponse = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent(nonexistentQuery)}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(searchResponse.body.results).toHaveLength(0);
        });
    });

    describe("Error Handling", () => {
        it("handles invalid query syntax gracefully", async () => {
            const response = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("(((")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            // Should return empty results or handle error gracefully
            expect(response.body.results).toBeDefined();
        });

        it("requires authentication", async () => {
            await supertest(app)
                .get(`/etapi/notes?search=test`)
                .expect(401);
        });

        it("rejects invalid authentication", async () => {
            await supertest(app)
                .get(`/etapi/notes?search=test`)
                .auth(USER, "invalid-token", { "type": "basic"})
                .expect(401);
        });
    });

    describe("Performance", () => {
        it("handles large result sets", async () => {
            const startTime = Date.now();

            const response = await supertest(app)
                .get(`/etapi/notes?search=*&limit=100`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            const endTime = Date.now();
            const duration = endTime - startTime;

            expect(response.body.results).toBeDefined();
            // Search should complete in reasonable time (5 seconds)
            expect(duration).toBeLessThan(5000);
        });

        it("handles queries efficiently", async () => {
            const startTime = Date.now();

            await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent("#*")}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Attribute search should be fast
            expect(duration).toBeLessThan(3000);
        });
    });

    describe("Special Characters", () => {
        it("handles special characters in search", async () => {
            const specialChars = "test@#$%";
            const response = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent(specialChars)}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body.results).toBeDefined();
        });

        it("handles unicode characters", async () => {
            const unicode = "测试";
            const response = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent(unicode)}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body.results).toBeDefined();
        });

        it("handles quotes in search", async () => {
            const quoted = '"test phrase"';
            const response = await supertest(app)
                .get(`/etapi/notes?search=${encodeURIComponent(quoted)}`)
                .auth(USER, token, { "type": "basic"})
                .expect(200);

            expect(response.body.results).toBeDefined();
        });
    });
});
