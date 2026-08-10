import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "./api_fixtures";
import { CoreApiTester } from "./api_tester";

let api: CoreApiTester;

describe("createTextNote fixture", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("creates a note under root and surfaces the API failure when the parent is unusable", async () => {
        const { noteId, branchId } = await createTextNote(api, { title: "Fixture note" });
        expect(noteId).toBeTruthy();
        expect(branchId).toBeTruthy();

        await expect(createTextNote(api, { parentNoteId: "missingParent123" }))
            .rejects.toThrow(/createTextNote failed/);
    });
});
