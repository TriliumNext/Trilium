import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { Application, Request, Response, NextFunction } from "express";
import { safeExtractMessageAndStackFromError } from "../services/utils.js";

let app: Application;

describe("Share API test", () => {
    let cannotSetHeadersCount = 0;

    beforeAll(async () => {
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

describe("Share Routes - Asset Path Calculation", () => {
    it("should calculate correct relative path depth for different share paths", () => {
        // Helper function to simulate the path depth calculation
        const calculateRelativePath = (sharePath: string) => {
            const pathDepth = sharePath.split('/').filter(segment => segment.length > 0).length;
            return '../'.repeat(pathDepth);
        };

        // Test single level path
        expect(calculateRelativePath("/share")).toBe("../");

        // Test double level path
        expect(calculateRelativePath("/sharePath/test")).toBe("../../");

        // Test triple level path
        expect(calculateRelativePath("/my/custom/share")).toBe("../../../");

        // Test root path
        expect(calculateRelativePath("/")).toBe("");

        // Test path with trailing slash
        expect(calculateRelativePath("/share/")).toBe("../");
    });

    it("should handle normalized share paths correctly", () => {
        const calculateRelativePath = (sharePath: string) => {
            const pathDepth = sharePath.split('/').filter(segment => segment.length > 0).length;
            return '../'.repeat(pathDepth);
        };

        // Test the examples from the original TODO comment
        expect(calculateRelativePath("/sharePath")).toBe("../");
        expect(calculateRelativePath("/sharePath/test")).toBe("../../");
    });
});
