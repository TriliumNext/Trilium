import { cls, date_notes } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import config from "../../src/services/config.js";
import { login } from "./utils.js";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/get-date-notes", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    it("obtains inbox", async () => {
        await supertest(app)
            .get("/etapi/inbox/2022-01-01")
            .auth(USER, token, { "type": "basic"})
            .expect(200);
    });

    describe("days", () => {
        it("obtains day from calendar", async () => {
            await supertest(app)
                .get("/etapi/calendar/days/2022-01-01")
                .auth(USER, token, { "type": "basic"})
                .expect(200);
        });

        it("detects invalid date", async () => {
            const response = await supertest(app)
                .get("/etapi/calendar/days/2022-1")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("DATE_INVALID");
        });
    });

    describe("weeks", () => {
        beforeAll(() => {
            cls.init(() => {
                const rootCalendarNote = date_notes.getRootCalendarNote();
                rootCalendarNote.setLabel("enableWeekNote");
            });
        });

        it("obtains week calendar", async () => {
            await supertest(app)
                .get("/etapi/calendar/weeks/2022-W01")
                .auth(USER, token, { "type": "basic"})
                .expect(200);
        });

        it("detects invalid date", async () => {
            const response = await supertest(app)
                .get("/etapi/calendar/weeks/2022-1")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("WEEK_INVALID");
        });
    });

    describe("months", () => {
        it("obtains month calendar", async () => {
            await supertest(app)
                .get("/etapi/calendar/months/2022-01")
                .auth(USER, token, { "type": "basic"})
                .expect(200);
        });

        it("detects invalid month", async () => {
            const response = await supertest(app)
                .get("/etapi/calendar/months/2022-1")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("MONTH_INVALID");
        });
    });

    describe("years", () => {
        it("obtains year calendar", async () => {
            await supertest(app)
                .get("/etapi/calendar/years/2022")
                .auth(USER, token, { "type": "basic"})
                .expect(200);
        });

        it("detects invalid year", async () => {
            const response = await supertest(app)
                .get("/etapi/calendar/years/202")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("YEAR_INVALID");
        });
    });
});
