import type { Application, NextFunction,Request, Response } from "express";
import supertest from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { safeExtractMessageAndStackFromError } from "../services/utils.js";

let app: Application;

describe("Share API test", () => {
    let cannotSetHeadersCount = 0;

    beforeAll(async () => {
        vi.useFakeTimers();
        const buildApp = (await import("../app.js")).default;
        app = await buildApp();
        app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
            const [ errMessage ] = safeExtractMessageAndStackFromError(err);
            if (errMessage.includes("Cannot set headers after they are sent to the client")) {
                cannotSetHeadersCount++;
            }

            next();
        });
    });

    beforeEach(() => {
        cannotSetHeadersCount = 0;
    });

    it("requests password for password-protected share", async () => {
        await supertest(app)
            .get("/share/YjlPRj2E9fOV")
            .expect(401)
            .expect("WWW-Authenticate", 'Basic realm="User Visible Realm", charset="UTF-8"');
        expect(cannotSetHeadersCount).toBe(0);
    });

    it("renders custom share template", async () => {
        const response = await supertest(app)
            .get("/share/pQvNLLoHcMwH")
            .expect(200);
        expect(cannotSetHeadersCount).toBe(0);
        expect(response.text).toContain("Content Start");
        expect(response.text).toContain("Content End");
    });

});
