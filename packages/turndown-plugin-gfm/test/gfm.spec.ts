import { describe, it, expect, beforeEach } from "vitest";
import TurndownService from "turndown";
import { gfm } from "../src/index.js";

describe("GFM plugin", () => {
    let turndown: TurndownService;

    beforeEach(() => {
        turndown = new TurndownService();
        turndown.use(gfm);
    });

    describe("strikethrough", () => {
        it("converts <strike> to ~~", () => {
            expect(turndown.turndown("<strike>Lorem ipsum</strike>")).toBe("~~Lorem ipsum~~");
        });

        it("converts <s> to ~~", () => {
            expect(turndown.turndown("<s>Lorem ipsum</s>")).toBe("~~Lorem ipsum~~");
        });

        it("converts <del> to ~~", () => {
            expect(turndown.turndown("<del>Lorem ipsum</del>")).toBe("~~Lorem ipsum~~");
        });
    });

    describe("task lists", () => {
        it("converts unchecked checkbox inputs", () => {
            const input = "<ul><li><input type=checkbox>Check Me!</li></ul>";
            expect(turndown.turndown(input)).toBe("*   [ ] Check Me!");
        });

        it("converts checked checkbox inputs", () => {
            const input = "<ul><li><input type=checkbox checked>Checked!</li></ul>";
            expect(turndown.turndown(input)).toBe("*   [x] Checked!");
        });
    });

    describe("tables", () => {
        it("converts basic table", () => {
            const input = `<table>
                <thead>
                    <tr>
                        <th>Column 1</th>
                        <th>Column 2</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Row 1, Column 1</td>
                        <td>Row 1, Column 2</td>
                    </tr>
                    <tr>
                        <td>Row 2, Column 1</td>
                        <td>Row 2, Column 2</td>
                    </tr>
                </tbody>
            </table>`;
            const expected = `| Column 1 | Column 2 |
| --- | --- |
| Row 1, Column 1 | Row 1, Column 2 |
| Row 2, Column 1 | Row 2, Column 2 |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles cell alignment", () => {
            const input = `<table>
                <thead>
                    <tr>
                        <th align="left">Column 1</th>
                        <th align="center">Column 2</th>
                        <th align="right">Column 3</th>
                        <th align="foo">Column 4</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td align="left">Row 1, Column 1</td>
                        <td align="center">Row 1, Column 2</td>
                        <td align="right">Row 1, Column 3</td>
                        <td align="foo">Row 1, Column 4</td>
                    </tr>
                    <tr>
                        <td>Row 2, Column 1</td>
                        <td>Row 2, Column 2</td>
                        <td>Row 2, Column 3</td>
                        <td>Row 2, Column 4</td>
                    </tr>
                </tbody>
            </table>`;
            const expected = `| Column 1 | Column 2 | Column 3 | Column 4 |
| :--- | :---: | ---: | --- |
| Row 1, Column 1 | Row 1, Column 2 | Row 1, Column 3 | Row 1, Column 4 |
| Row 2, Column 1 | Row 2, Column 2 | Row 2, Column 3 | Row 2, Column 4 |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles empty cells", () => {
            const input = `<table>
                <thead>
                    <tr>
                        <th align="left">Column 1</th>
                        <th align="center">Column 2</th>
                        <th align="right">Column 3</th>
                        <th align="foo">Column 4</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td></td>
                        <td>Row 1, Column 2</td>
                        <td>Row 1, Column 3</td>
                        <td>Row 1, Column 4</td>
                    </tr>
                    <tr>
                        <td>Row 2, Column 1</td>
                        <td></td>
                        <td>Row 2, Column 3</td>
                        <td>Row 2, Column 4</td>
                    </tr>
                    <tr>
                        <td>Row 3, Column 1</td>
                        <td>Row 3, Column 2</td>
                        <td></td>
                        <td>Row 3, Column 4</td>
                    </tr>
                    <tr>
                        <td>Row 4, Column 1</td>
                        <td>Row 4, Column 2</td>
                        <td>Row 4, Column 3</td>
                        <td></td>
                    </tr>
                    <tr>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td>Row 5, Column 4</td>
                    </tr>
                </tbody>
            </table>`;
            const expected = `| Column 1 | Column 2 | Column 3 | Column 4 |
| --- | --- | --- | --- |
|  | Row 1, Column 2 | Row 1, Column 3 | Row 1, Column 4 |
| Row 2, Column 1 |  | Row 2, Column 3 | Row 2, Column 4 |
| Row 3, Column 1 | Row 3, Column 2 |  | Row 3, Column 4 |
| Row 4, Column 1 | Row 4, Column 2 | Row 4, Column 3 |  |
|  |  |  | Row 5, Column 4 |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles empty rows", () => {
            const input = `<table>
                <thead>
                    <tr>
                        <th>Heading 1</th>
                        <th>Heading 2</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Row 1</td>
                        <td>Row 1</td>
                    </tr>
                    <tr>
                        <td></td>
                        <td></td>
                    </tr>
                    <tr>
                        <td>Row 3</td>
                        <td>Row 3</td>
                    </tr>
                </tbody>
            </table>`;
            const expected = `| Heading 1 | Heading 2 |
| --- | --- |
| Row 1 | Row 1 |
|  |  |
| Row 3 | Row 3 |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles th in first row", () => {
            const input = `<table>
                <tr>
                    <th>Heading</th>
                </tr>
                <tr>
                    <td>Content</td>
                </tr>
            </table>`;
            const expected = `| Heading |
| --- |
| Content |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles th first row in tbody", () => {
            const input = `<table>
                <tbody>
                    <tr>
                        <th>Heading</th>
                    </tr>
                    <tr>
                        <td>Content</td>
                    </tr>
                </tbody>
            </table>`;
            const expected = `| Heading |
| --- |
| Content |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles table with two tbodies", () => {
            const input = `<table>
                <tbody>
                    <tr>
                        <th>Heading</th>
                    </tr>
                    <tr>
                        <td>Content</td>
                    </tr>
                </tbody>
                <tbody>
                    <tr>
                        <th>Heading</th>
                    </tr>
                    <tr>
                        <td>Content</td>
                    </tr>
                </tbody>
            </table>`;
            const expected = `| Heading |
| --- |
| Content |
| Heading |
| Content |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles heading cells in both thead and tbody", () => {
            const input = `<table>
                <thead><tr><th>Heading</th></tr></thead>
                <tbody><tr><th>Cell</th></tr></tbody>
            </table>`;
            const expected = `| Heading |
| --- |
| Cell |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles empty head", () => {
            const input = `<table>
                <thead><tr><th></th></tr></thead>
                <tbody><tr><th>Heading</th></tr></tbody>
            </table>`;
            const expected = `|  |
| --- |
| Heading |
| --- |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles non-definitive heading row", () => {
            const input = `<table>
                <tr><td>Row 1 Cell 1</td><td>Row 1 Cell 2</td></tr>
                <tr><td>Row 2 Cell 1</td><td>Row 2 Cell 2</td></tr>
            </table>`;
            const expected = `|  |  |
| --- | --- |
| Row 1 Cell 1 | Row 1 Cell 2 |
| Row 2 Cell 1 | Row 2 Cell 2 |`;
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("handles non-definitive heading row with th", () => {
            const input = `<table>
                <tr>
                    <th>Heading</th>
                    <td>Not a heading</td>
                </tr>
                <tr>
                    <td>Heading</td>
                    <td>Not a heading</td>
                </tr>
            </table>`;
            const expected = `|  |  |
| --- | --- |
| Heading | Not a heading |
| Heading | Not a heading |`;
            expect(turndown.turndown(input)).toBe(expected);
        });
    });

    describe("highlighted code blocks", () => {
        it("converts highlighted HTML code block", () => {
            const input = `<div class="highlight highlight-text-html-basic">
                <pre>&lt;<span class="pl-ent">p</span>&gt;Hello world&lt;/<span class="pl-ent">p</span>&gt;</pre>
            </div>`;
            const expected = "```html\n<p>Hello world</p>\n```";
            expect(turndown.turndown(input)).toBe(expected);
        });

        it("converts highlighted JS code block", () => {
            const input = `<div class="highlight highlight-source-js">
                <pre>;(<span class="pl-k">function</span> () {})()</pre>
            </div>`;
            const expected = "```js\n;(function () {})()\n```";
            expect(turndown.turndown(input)).toBe(expected);
        });
    });
});
