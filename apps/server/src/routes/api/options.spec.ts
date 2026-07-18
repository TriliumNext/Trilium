import { getSql, options as optionService } from "@triliumnext/core";
import type { Application } from "express";
import i18next from "i18next";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Application;
let agent: ReturnType<typeof supertest.agent>;
let csrfToken: string;

// optionService.getOption() reads from becca's in-memory cache, which is mutated
// *before* the SQL write runs. A rolled-back write therefore leaves becca stale,
// so the rollback test asserts against the DB row directly.
function readOptionFromDb(name: string): string | null {
    const row = getSql().getRowOrNull<{ value: string }>(
        "SELECT value FROM options WHERE name = ?",
        [name]
    );
    return row?.value ?? null;
}

function putOptions(body: Record<string, string>) {
    return agent
        .put("/api/options")
        .set("x-csrf-token", csrfToken)
        .send(body);
}

describe("Options API", () => {
    beforeAll(async () => {
        const buildApp = (await import("../../app.js")).default;
        app = await buildApp();
        agent = supertest.agent(app);

        await agent.post("/login").send({ password: "demo1234" }).expect(302);

        const boot = await agent.get("/bootstrap").expect(200);
        csrfToken = boot.body.csrfToken;
        expect(csrfToken).toBeTruthy();
    });

    it("updates a batch of allowed options", async () => {
        await putOptions({ mainFontSize: "115", treeFontSize: "85" }).expect(204);

        expect(readOptionFromDb("mainFontSize")).toBe("115");
        expect(readOptionFromDb("treeFontSize")).toBe("85");
    });

    it("rolls back the entire batch when one option is not allowed", async () => {
        // Establish a known baseline before the failing batch.
        await putOptions({ mainFontSize: "100" }).expect(204);

        // The allowed option is iterated first, so without an outer transaction
        // it would be committed before the disallowed key triggers the throw.
        await putOptions({ mainFontSize: "200", notAnAllowedOption: "x" }).expect(500);

        expect(readOptionFromDb("mainFontSize")).toBe("100");
    });

    it("waits for the locale change to fully apply before returning", async () => {
        await putOptions({ locale: "en" }).expect(204);
        expect(i18next.language).toBe("en");

        await putOptions({ locale: "fr" }).expect(204);
        expect(i18next.language).toBe("fr");
    });

    it("updates a single option via the :name/:value route", async () => {
        await agent
            .put("/api/options/mainFontSize/123")
            .set("x-csrf-token", csrfToken)
            .expect(204);

        expect(optionService.getOption("mainFontSize")).toBe("123");
    });
});
