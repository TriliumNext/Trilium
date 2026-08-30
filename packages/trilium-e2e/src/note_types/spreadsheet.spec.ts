import { expect, test } from "@playwright/test";

import App from "../support/app";

/**
 * A sheet whose every row would outgrow the height it declares if the renderer let it: text that
 * wraps, text turned a quarter turn, and cells carrying borders. The printed grid has to stay at
 * the declared heights, because a floating image is placed in those coordinates and drifts away
 * from the cells as soon as they do not hold.
 */
const WORKBOOK = {
    version: 1,
    workbook: {
        sheetOrder: ["s1"],
        styles: {},
        sheets: {
            s1: {
                id: "s1",
                name: "Sheet1",
                hidden: 0,
                // Gridlines are drawn by the stylesheets, not the emitter, and their width differs
                // between print and the share view, so they are left off to keep this about the
                // geometry the emitter itself states.
                showGridlines: 0,
                mergeData: [],
                rowData: {
                    // A row Univer measured for itself, which is stored as `ah` rather than `h`.
                    "0": { ah: 30 },
                    "1": { h: 40 },
                    "2": { h: 24 },
                    "3": { h: 24 },
                    "4": { h: 60 }
                },
                columnData: { "0": { w: 90 }, "1": { w: 90 } },
                cellData: {
                    "0": {
                        "0": { v: "wraps onto several lines when it is allowed to", t: 1, s: { tb: 3 } },
                        "1": { v: "plain", t: 1 }
                    },
                    "1": {
                        "0": { v: "turned a quarter turn", t: 1, s: { tr: { a: 90 } } },
                        "1": { v: "stacked", t: 1, s: { tr: { a: 0, v: 1 } } }
                    },
                    // A transform paints outside its layout box but must not move the row.
                    "4": {
                        "0": { v: "tilted up", t: 1, s: { tr: { a: 45 } } },
                        "1": { v: "tilted down", t: 1, s: { tr: { a: -45 } } }
                    },
                    "2": {
                        "0": { v: "bordered", t: 1, s: { bd: { t: { s: 1 }, b: { s: 1 } } } },
                        "1": { v: 42, t: 2, s: { bd: { t: { s: 8 }, b: { s: 8 } } } }
                    },
                    "3": {
                        "0": { v: "a long single line that runs past its own column", t: 1 },
                        "1": { v: "stops it", t: 1 }
                    }
                }
            }
        }
    }
};

/**
 * The heights the workbook above states, in order. Read from here rather than back out of the
 * markup: the renderer writes a row's height into the stylesheet it emits, so the `tr` carries a
 * class and not a `style` attribute, and a test that read one would be asserting the DOM agrees
 * with itself rather than that the sheet's own numbers survived.
 */
const DECLARED_HEIGHTS = [30, 40, 24, 24, 60];

test("prints the grid at the row heights the sheet declares", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    const noteId = await createSpreadsheet(app, JSON.stringify(WORKBOOK));

    try {
        await app.goto({ url: `/?print=#root/${noteId}` });
        await page.waitForSelector(".spreadsheet-table");

        const rows = await page.evaluate(() => {
            const table = document.querySelector(".spreadsheet-table");
            const base = table?.getBoundingClientRect().top ?? 0;
            return [...(table?.querySelectorAll("tr") ?? [])].map((row) => ({
                top: row.getBoundingClientRect().top - base,
                rendered: row.getBoundingClientRect().height
            }));
        });

        expect(rows.length).toBe(DECLARED_HEIGHTS.length);

        let expectedTop = 0;
        for (const [index, row] of rows.entries()) {
            const declared = DECLARED_HEIGHTS[index];
            expect(row.rendered, `row ${index} keeps the height it declares`).toBeCloseTo(declared, 0);
            expect(row.top, `row ${index} starts where the rows above it end`).toBeCloseTo(expectedTop, 0);
            expectedTop += declared;
        }
    } finally {
        await deleteNote(app, noteId);
    }
});

/**
 * Creates a spreadsheet note under the root and returns its id. The request goes from inside the
 * page so standalone's service worker routes it to the SQLite worker, as `setOption` does.
 */
async function createSpreadsheet(app: App, content: string): Promise<string> {
    const result = await app.page.evaluate(async (body) => {
        const csrfToken = (window as any).glob.csrfToken;
        const response = await fetch("/api/notes/root/children?target=into", {
            method: "POST",
            headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
            body: JSON.stringify({
                title: "Spreadsheet geometry fixture",
                type: "spreadsheet",
                mime: "application/json",
                content: body
            })
        });
        if (!response.ok) return { ok: false, status: response.status, noteId: "" };
        const created = await response.json();
        return { ok: true, status: response.status, noteId: created.note.noteId as string };
    }, content);

    expect(result.ok, `creating the fixture note failed (status=${result.status})`).toBe(true);
    return result.noteId;
}

async function deleteNote(app: App, noteId: string): Promise<void> {
    await app.page.evaluate(async (id) => {
        const csrfToken = (window as any).glob.csrfToken;
        await fetch(`/api/notes/${id}`, { method: "DELETE", headers: { "x-csrf-token": csrfToken } });
    }, noteId);
}
