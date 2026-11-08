import { ObjectMatrix } from "@univerjs/core";
import type { ICellDataWithSpanInfo } from "@univerjs/sheets-ui";
import { describe, expect, it } from "vitest";

import { stripPastedFontFamilies } from "./clipboard";

describe("stripPastedFontFamilies", () => {
    it("removes the font family from cell styles and rich-text runs, keeping the rest", () => {
        const matrix = new ObjectMatrix<ICellDataWithSpanInfo>();
        matrix.setValue(0, 0, { v: "plain", s: { ff: "Aptos Narrow", fs: 11, bl: 1 } });
        matrix.setValue(0, 1, {
            v: "rich",
            s: { ff: "Calibri" },
            p: {
                id: "d",
                documentStyle: { textStyle: { ff: "Calibri", it: 1 } },
                body: {
                    dataStream: "rich\r\n",
                    textRuns: [
                        { st: 0, ed: 2, ts: { ff: "Arial", bl: 1 } },
                        { st: 2, ed: 4, ts: { ff: "Arial" } }
                    ]
                }
            }
        });
        matrix.setValue(1, 0, { v: "unstyled" });
        matrix.setValue(1, 1, { v: "style id", s: "styleId" });

        stripPastedFontFamilies(matrix);

        expect(matrix.getValue(0, 0)).toEqual({ v: "plain", s: { fs: 11, bl: 1 } });
        const rich = matrix.getValue(0, 1);
        expect(rich?.s).toEqual({});
        expect(rich?.p?.documentStyle.textStyle).toEqual({ it: 1 });
        expect(rich?.p?.body?.textRuns?.map((run) => run.ts)).toEqual([ { bl: 1 }, {} ]);
        expect(matrix.getValue(1, 0)).toEqual({ v: "unstyled" });
        expect(matrix.getValue(1, 1)).toEqual({ v: "style id", s: "styleId" });
    });
});
