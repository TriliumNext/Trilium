import { describe, expect, it } from "vitest";

import { getBlockRangeContent, replaceBlockRangeContent } from "./block_ranges";

const BEFORE = `<h2 class='title'>Intro</h2><!-- kept -->\n<p>Skip&nbsp;me</p>`;
const RANGE = `<p data-trilium-block-id="a">A</p><ul><li>x</li></ul>`
    + `<p data-trilium-block-id='b'>B</p>`;
const AFTER = `<p data-trilium-block-id="c">C</p>`;
const NOTE = `${BEFORE}${RANGE}${AFTER}`;

const LIST = `<ol start="3" class="numbered">`
    + `<li><p data-trilium-block-id="x">3</p></li>\n`
    + `<li><p data-trilium-block-id="a">4</p></li>`
    + `<li><p data-trilium-block-id="b">5</p></li>`
    + `<li><p>6</p></li></ol>`;

describe("getBlockRangeContent", () => {
    it("returns the blocks as they are stored, and list items inside their list", () => {
        expect(getBlockRangeContent(NOTE, "a:b")).toBe(RANGE);
        expect(getBlockRangeContent(NOTE, "c")).toBe(AFTER);
        expect(getBlockRangeContent(`<p>Before</p>${LIST}`, "a:b")).toBe(
            `<ol start="4" class="numbered">`
            + `<li><p data-trilium-block-id="a">4</p></li>`
            + `<li><p data-trilium-block-id="b">5</p></li></ol>`
        );
    });

    it("returns nothing for missing blocks, or blocks that cannot be edited apart", () => {
        expect(getBlockRangeContent(NOTE, "a:z")).toBeNull();
        expect(getBlockRangeContent(`<ul><li><p>x</p><p data-trilium-block-id="a">A</p></li>`
            + `<li><p data-trilium-block-id="b">B</p></li></ul>`, "a:b")).toBeNull();
    });
});

describe("replaceBlockRangeContent", () => {
    it("replaces the blocks and keeps the rest of the content as it is", () => {
        const fragment = `<p data-trilium-block-id="a">New A</p><p data-trilium-block-id="n">N</p>`;

        expect(replaceBlockRangeContent(NOTE, "a:b", fragment)).toBe(`${BEFORE}${fragment}${AFTER}`);
        expect(replaceBlockRangeContent(NOTE, "a:z", fragment)).toBeNull();
    });

    it("drops the block ids that the rest of the content holds", () => {
        const fragment = `<p data-trilium-block-id="a">A</p><p data-trilium-block-id="c">Copy</p>`
            + `<p data-trilium-block-id="b">B</p>`;

        expect(replaceBlockRangeContent(NOTE, "a:b", fragment)).toBe(
            `${BEFORE}<p data-trilium-block-id="a">A</p><p>Copy</p>`
            + `<p data-trilium-block-id="b">B</p>${AFTER}`
        );
    });

    it("replaces list items inside their list", () => {
        const fragment = `<ol start="4" class="numbered">`
            + `<li><p data-trilium-block-id="a">Four</p></li>`
            + `<li><p data-trilium-block-id="b">Five</p></li></ol>`;

        expect(replaceBlockRangeContent(LIST, "a:b", fragment)).toBe(
            `<ol start="3" class="numbered">`
            + `<li><p data-trilium-block-id="x">3</p></li>\n`
            + `<li><p data-trilium-block-id="a">Four</p></li>`
            + `<li><p data-trilium-block-id="b">Five</p></li>`
            + `<li><p>6</p></li></ol>`
        );
    });

    it("splits the list around list items that change into other content", () => {
        const paragraph = `<p data-trilium-block-id="a">Not an item</p>`;
        const bullets = `<ul><li><p data-trilium-block-id="x">Bullet</p></li></ul>`;

        expect(replaceBlockRangeContent(LIST, "a:b", paragraph)).toBe(
            `<ol start="3" class="numbered"><li><p data-trilium-block-id="x">3</p></li>\n</ol>`
            + paragraph
            + `<ol start="3" class="numbered"><li><p>6</p></li></ol>`
        );
        expect(replaceBlockRangeContent(LIST, "x:a", bullets)).toBe(
            `${bullets}<ol start="3" class="numbered">`
            + `<li><p data-trilium-block-id="b">5</p></li><li><p>6</p></li></ol>`
        );
    });
});
