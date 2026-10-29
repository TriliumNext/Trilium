import { type ContentJobExecutor, runContentJob } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { expect } from "vitest";

export async function login(app: Application) {
    // Obtain auth token.
    const response = await supertest(app)
        .post("/etapi/auth/login")
        .send({
            "password": "demo1234"
        })
        .expect(201);
    const token = response.body.authToken;
    expect(token).toBeTruthy();
    return token;
}

export async function createNote(app: Application, token: string, content?: string) {
    const response = await supertest(app)
        .post("/etapi/create-note")
        .auth("etapi", token, { "type": "basic"})
        .send({
            "parentNoteId": "root",
            "title": "Hello",
            "type": "text",
            "content": content ?? "Hi there!",
        })
        .expect(201);

    const noteId = response.body.note.noteId as string;
    expect(noteId).toStrictEqual(noteId);
    return noteId;
}

/**
 * A content-job executor that runs each job after a seeded random delay, so conversions overlap and
 * later ones regularly finish first. Records start and finish order to prove that they did.
 */
export function outOfOrderContentJobs(seed = 17) {
    let nextId = 0;
    let inFlight = 0;
    const stats = { started: [] as number[], finished: [] as number[], maxInFlight: 0 };
    const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };

    const executor: ContentJobExecutor = {
        run: async (job) => {
            const id = nextId++;
            stats.started.push(id);
            inFlight++;
            stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
            try {
                await new Promise((resolve) => setTimeout(resolve, random() * 4));
                return await runContentJob(job);
            } finally {
                inFlight--;
                stats.finished.push(id);
            }
        }
    };

    return { executor, stats };
}
