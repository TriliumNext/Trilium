import type { Application } from "express";
import supertest from "supertest";
import { expect } from "vitest";

export type ApiAgent = ReturnType<typeof supertest.agent>;

export interface ApiTestContext {
    app: Application;
    agent: ApiAgent;
    /**
     * CSRF token that must be set as the `x-csrf-token` header on mutating
     * (POST/PUT/PATCH/DELETE) requests.
     */
    csrfToken: string;
}

/**
 * Boots the full server Express app against the in-memory demo fixture DB and
 * performs the browser login handshake, returning an authenticated supertest
 * agent plus a CSRF token.
 *
 * Mirrors `apps/server/src/routes/api/options.spec.ts`: `POST /login`
 * establishes the session cookie, `GET /bootstrap` issues the CSRF cookie and
 * token. The agent persists both cookies across subsequent requests. CSRF uses
 * the double-submit pattern, so GET/HEAD/OPTIONS need no token; only mutating
 * verbs do.
 *
 * Each spec file runs in its own vitest fork (`pool: "forks"`) with a fresh
 * in-memory copy of the fixture, so mutations don't leak across files — call
 * this once per file in `beforeAll()`.
 */
export async function bootLoggedInApp(): Promise<ApiTestContext> {
    const buildApp = (await import("../../src/app.js")).default;
    const app = await buildApp();
    const agent = supertest.agent(app);

    await agent.post("/login").send({ password: "demo1234" }).expect(302);

    const boot = await agent.get("/bootstrap").expect(200);
    const csrfToken = boot.body.csrfToken as string;
    expect(csrfToken).toBeTruthy();

    return { app, agent, csrfToken };
}

export interface CreatedNote {
    noteId: string;
    branchId: string;
}

interface CreateNoteOptions {
    parentNoteId?: string;
    title?: string;
    content?: string;
}

/**
 * Creates a disposable child note through the internal API and returns its
 * `{ noteId, branchId }`. Lets tests operate on a known note without coupling
 * to specific fixture content.
 */
export async function createTextNote(
    { agent, csrfToken }: ApiTestContext,
    { parentNoteId = "root", title = "Test note", content = "<p>hello</p>" }: CreateNoteOptions = {}
): Promise<CreatedNote> {
    const res = await agent
        .post(`/api/notes/${parentNoteId}/children?target=into`)
        .set("x-csrf-token", csrfToken)
        .send({ title, type: "text", content })
        .expect(200);

    return {
        noteId: res.body.note.noteId as string,
        branchId: res.body.branch.branchId as string
    };
}
