import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
    it("splits plain rows and fields", () => {
        expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    });

    it("handles quoted fields with embedded commas, newlines and doubled quotes", () => {
        expect(parseCsv(`"a,b","line1\nline2","he said ""hi"""`)).toEqual([["a,b", "line1\nline2", `he said "hi"`]]);
    });

    it("accepts CRLF, LF and CR record terminators", () => {
        expect(parseCsv("a,b\r\nc,d\ne,f\rg,h")).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
    });

    it("strips a leading BOM, drops a single trailing terminator, but keeps a blank middle row", () => {
        const bom = String.fromCharCode(0xfeff);
        expect(parseCsv(`${bom}a,b\n\nc,d\n`)).toEqual([["a", "b"], [""], ["c", "d"]]);
    });

    it("returns no rows for empty input", () => {
        expect(parseCsv("")).toEqual([]);
    });
});
