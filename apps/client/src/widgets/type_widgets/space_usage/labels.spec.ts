import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    t: vi.fn((key: string) => key)
}));

vi.mock("../../../services/i18n", () => ({ t: mocks.t }));

import { deletedEntitiesLabel } from "./labels";

describe("deletedEntitiesLabel", () => {
    it("names both counts, and a bucket the response left out counts as zero", () => {
        deletedEntitiesLabel({ size: 900, noteCount: 0, attachmentCount: 2 });

        // Both, always: a size covering deleted attachments read as "in 0 notes" otherwise.
        expect(mocks.t).toHaveBeenCalledWith("space_usage.deleted_notes", { count: 0 });
        expect(mocks.t).toHaveBeenCalledWith("space_usage.deleted_attachments", { count: 2 });

        mocks.t.mockClear();
        // Only the root's usage carries the bucket; elsewhere the phrase still has to hold together.
        deletedEntitiesLabel(undefined);
        expect(mocks.t).toHaveBeenCalledWith("space_usage.deleted_notes", { count: 0 });
        expect(mocks.t).toHaveBeenCalledWith("space_usage.deleted_attachments", { count: 0 });
    });
});
