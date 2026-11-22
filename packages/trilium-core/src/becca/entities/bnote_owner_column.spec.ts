import { describe, expect, it, vi } from "vitest";

import { getSql } from "../../services/sql/index.js";
import becca from "../becca.js";

describe("BNote.getPojoToSave and the ownerId column probe", () => {
    it("leaves out ownerId while the probe fails, and probes again on the next save", () => {
        const root = becca.getNoteOrThrow("root");
        const getColumn = vi.spyOn(getSql(), "getColumn").mockImplementationOnce(() => {
            throw new Error("no database");
        });

        expect(root.getPojoToSave()).not.toHaveProperty("ownerId");
        expect(root.getPojoToSave()).toHaveProperty("ownerId");
        expect(getColumn).toHaveBeenCalledTimes(2);
        getColumn.mockRestore();
    });
});
