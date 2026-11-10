import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resources = vi.hoisted(() => ({
    getStatus: vi.fn(),
    startDownload: vi.fn(),
    cancelDownload: vi.fn(),
    delete: vi.fn(),
    deleteForeign: vi.fn()
}));

vi.mock("../../services/resources.js", () => ({ default: resources }));

import resourcesRoute from "./resources.js";

beforeEach(() => {
    for (const mock of Object.values(resources)) {
        mock.mockReset();
    }
});

describe("resources API", () => {
    it("reports every resource without ids, and the listed ones with them", async () => {
        resources.getStatus.mockResolvedValue({ resources: [] });

        await expect(resourcesRoute.getStatus(req({ query: {} }))).resolves.toEqual({ resources: [] });
        await resourcesRoute.getStatus(req({ query: { ids: "ocr,whisper" } }));
        await resourcesRoute.getStatus(req({ query: { ids: [ "ocr" ] } }));

        expect(resources.getStatus.mock.calls).toEqual([ [ undefined ], [ [ "ocr", "whisper" ] ], [ [ "ocr" ] ] ]);
    });

    it("starts a download of the ids in the body", () => {
        const progress = { downloadId: "d1" };
        resources.startDownload.mockReturnValue(progress);

        expect(resourcesRoute.startDownload(req({ body: { ids: [ "ocr", "whisper" ] } }))).toBe(progress);
        expect(resources.startDownload).toHaveBeenCalledExactlyOnceWith([ "ocr", "whisper" ]);
    });

    it("rejects a missing, empty or non-string list of ids", () => {
        for (const body of [ undefined, {}, { ids: [] }, { ids: [ "ocr", 5 ] }, { ids: 5 } ]) {
            expect(() => resourcesRoute.startDownload(req({ body })))
                .toThrow(new ValidationError("Expected a list of resource IDs."));
        }
        expect(() => resourcesRoute.getStatus(req({ query: { ids: { a: "b" } } })))
            .toThrow(new ValidationError("Expected a list of resource IDs."));
        expect(resources.startDownload).not.toHaveBeenCalled();
        expect(resources.getStatus).not.toHaveBeenCalled();
    });

    it("cancels a download and deletes resources and foreign entries by the ids in the path", async () => {
        resources.delete.mockResolvedValue(undefined);
        resources.deleteForeign.mockResolvedValue(undefined);

        expect(resourcesRoute.cancelDownload(req({ params: { downloadId: "d1" } }) as Request<{ downloadId: string }>)).toBeUndefined();
        await expect(resourcesRoute.deleteResource(req({ params: { id: "ocr" } }) as Request<{ id: string }>)).resolves.toBeUndefined();
        await expect(resourcesRoute.deleteForeign(req({ params: { name: "stray" } }) as Request<{ name: string }>)).resolves.toBeUndefined();

        expect(resources.cancelDownload).toHaveBeenCalledExactlyOnceWith("d1");
        expect(resources.delete).toHaveBeenCalledExactlyOnceWith("ocr");
        expect(resources.deleteForeign).toHaveBeenCalledExactlyOnceWith("stray");
    });
});

function req(parts: { query?: unknown; body?: unknown; params?: Record<string, string> }) {
    return { query: {}, params: {}, ...parts } as unknown as Request;
}
