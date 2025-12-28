import { describe, expect, it } from "vitest";
import { buildNote } from "../../../test/easy-froca";
import getAttributeDefinitionInformation from "./rows.js";

describe("getAttributeDefinitionInformation", () => {
    it("handles attributes with colons in their names", async () => {
        const note = buildNote({
            title: "Note 1",
            "#label:TEST:TEST1(inheritable)": "promoted,alias=Test1,single,text",
            "#label:Test_Test2(inheritable)": "promoted,alias=Test2,single,text",
            "#label:TEST:Test3(inheritable)": "promoted,alias=test3,single,text",
            "#relation:TEST:TEST4(inheritable)": "promoted,alias=Test4,single",
            "#relation:TEST:TEST5(inheritable)": "promoted,alias=Test5,single",
            "#label:_TEST:TEST:TEST:Test1(inheritable)": "promoted,alias=Test01,single,text"
        });
        const infos = getAttributeDefinitionInformation(note);
        expect(infos).toMatchObject([
            { name: "TEST:TEST1", type: "text" },
            { name: "Test_Test2", type: "text" },
            { name: "TEST:Test3", type: "text" },
            { name: "TEST:TEST4", type: "relation" },
            { name: "TEST:TEST5", type: "relation" },
            { name: "_TEST:TEST:TEST:Test1", type: "text" }
        ]);
    });
});
