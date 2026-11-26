import { cls, options } from "@triliumnext/core";
import { withServerTexts } from "@triliumnext/core/src/test/translations.js";
import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markAsInternalElectronRequest } from "../../services/electron_request.js";
import sqlInit from "../../services/sql_init.js";
import downloadTokenRoute, { checkDownloadToken } from "./download_token.js";

const FILE = "/backups/backup-daily.db";

function download(query: Record<string, string>, sessionID = "session-a") {
    const req = { query, sessionID, headers: {} } as unknown as Request;
    const outcome: { isPassed: boolean; status: number; body?: string } = {
        isPassed: false,
        status: 0
    };
    const res = {
        setHeader: () => res,
        status: (status: number) => {
            outcome.status = status;
            return res;
        },
        send: (body: string) => {
            outcome.body = body;
            return res;
        }
    } as unknown as Response;
    checkDownloadToken("backup")(req, res, (() => { outcome.isPassed = true; }) as NextFunction);
    return outcome;
}

function issue(body: unknown, sessionID = "session-a") {
    return downloadTokenRoute.issueDownloadToken({ body, sessionID } as unknown as Request).token;
}

describe("download tokens while the second factor is legacy", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        cls.init(() => options.setOption("secondFactorState", ""));
    });

    it("lets every download through while the factor is not legacy", () => {
        expect(download({ filePath: FILE })).toEqual({ isPassed: true, status: 0 });
    });

    it("refuses a download without a token in the server's language", async () => {
        cls.init(() => options.setOption("secondFactorState", "legacy"));

        const outcome = await withServerTexts(
            { "second_factor.download-refused": "refused" },
            () => download({ filePath: FILE })
        );

        expect(outcome).toEqual({ isPassed: false, status: 401, body: "refused" });
    });

    it("lets through only the token's file, for its session, once and within a minute", () => {
        cls.init(() => options.setOption("secondFactorState", "legacy"));
        expect(download({ filePath: FILE }).status).toBe(401);

        const token = issue({ kind: "backup", filePath: FILE });
        expect(download({ filePath: "/backups/other.db", downloadToken: token }).status).toBe(401);

        const another = issue({ kind: "backup", filePath: FILE });
        expect(download({ filePath: FILE, downloadToken: another }, "session-b").status).toBe(401);

        const right = issue({ kind: "backup", filePath: FILE });
        expect(download({ filePath: FILE, downloadToken: right }).isPassed).toBe(true);
        expect(download({ filePath: FILE, downloadToken: right }).status).toBe(401);

        const ofASupportCopy = issue({ kind: "anonymized", filePath: FILE });
        expect(download({ filePath: FILE, downloadToken: ofASupportCopy }).status).toBe(401);

        const kept = issue({ kind: "backup", filePath: FILE });
        issue({ kind: "backup", filePath: FILE });
        expect(download({ filePath: FILE, downloadToken: kept }).isPassed).toBe(true);

        vi.useFakeTimers();
        const late = issue({ kind: "backup", filePath: FILE });
        vi.advanceTimersByTime(60 * 1000);
        issue({ kind: "backup", filePath: FILE });
        expect(download({ filePath: FILE, downloadToken: late }).status).toBe(401);
    });

    it("lets through the desktop app and the setup wizard, whose token guards every route", () => {
        cls.init(() => options.setOption("secondFactorState", "legacy"));

        const req = {
            query: { filePath: FILE },
            sessionID: "s",
            headers: {}
        } as unknown as Request;
        markAsInternalElectronRequest(req);
        const next = vi.fn();
        checkDownloadToken("backup")(req, {} as Response, next);
        expect(next).toHaveBeenCalled();

        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        expect(download({ filePath: FILE }).isPassed).toBe(true);
    });

    it("refuses a request that names no file of a known kind", () => {
        expect(() => issue({ kind: "secrets", filePath: FILE }))
            .toThrow("names the kind and the path");
        expect(() => issue({ kind: "backup" })).toThrow("names the kind and the path");
        expect(() => issue(undefined)).toThrow("names the kind and the path");
    });
});
