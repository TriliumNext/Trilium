import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import buildHiddenSubtreeTemplates from "./hidden_subtree_templates.js";

function childById(root: HiddenSubtreeItem, id: string): HiddenSubtreeItem {
    const child = root.children?.find((c) => c.id === id);
    expect(child, `expected child ${id} to exist`).toBeDefined();
    return child!;
}

function viewTypeOf(item: HiddenSubtreeItem): string | undefined {
    return item.attributes?.find((a) => a.name === "viewType")?.value;
}

describe("buildHiddenSubtreeTemplates", () => {
    it("builds the _templates book root with enforced attributes", () => {
        const templates = buildHiddenSubtreeTemplates();

        expect(templates.id).toBe("_templates");
        expect(templates.type).toBe("book");
        expect(templates.enforceAttributes).toBe(true);
        expect(templates.children?.length).toBeGreaterThan(0);
    });

    it("marks every direct child template with enforceAttributes", () => {
        const templates = buildHiddenSubtreeTemplates();

        for (const child of templates.children ?? []) {
            expect(child.enforceAttributes, `child ${child.id}`).toBe(true);
        }
    });

    it("exposes the expected set of template ids exactly once", () => {
        const templates = buildHiddenSubtreeTemplates();
        const ids = (templates.children ?? []).map((c) => c.id);

        expect(ids).toEqual([
            "_template_text_snippet",
            "_template_list_view",
            "_template_grid_view",
            "_template_calendar",
            "_template_table",
            "_template_geo_map",
            "_template_board",
            "_template_presentation_slide",
            "_template_presentation"
        ]);
        // No duplicate ids.
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("tags each collection template with its matching viewType label", () => {
        const templates = buildHiddenSubtreeTemplates();

        expect(viewTypeOf(childById(templates, "_template_list_view"))).toBe("list");
        expect(viewTypeOf(childById(templates, "_template_grid_view"))).toBe("grid");
        expect(viewTypeOf(childById(templates, "_template_calendar"))).toBe("calendar");
        expect(viewTypeOf(childById(templates, "_template_table"))).toBe("table");
        expect(viewTypeOf(childById(templates, "_template_geo_map"))).toBe("geoMap");
        expect(viewTypeOf(childById(templates, "_template_board"))).toBe("board");
        expect(viewTypeOf(childById(templates, "_template_presentation"))).toBe("presentation");
    });

    it("flags collection templates as templates and as collections", () => {
        const templates = buildHiddenSubtreeTemplates();
        const collectionIds = [
            "_template_list_view",
            "_template_grid_view",
            "_template_calendar",
            "_template_table",
            "_template_geo_map",
            "_template_board",
            "_template_presentation"
        ];

        for (const id of collectionIds) {
            const item = childById(templates, id);
            const names = (item.attributes ?? []).map((a) => a.name);
            expect(names, id).toContain("template");
            expect(names, id).toContain("collection");
        }
    });

    it("configures the text snippet template as a text note with promoted description", () => {
        const templates = buildHiddenSubtreeTemplates();
        const snippet = childById(templates, "_template_text_snippet");

        expect(snippet.type).toBe("text");
        const names = (snippet.attributes ?? []).map((a) => a.name);
        expect(names).toContain("template");
        expect(names).toContain("textSnippet");

        const descriptor = snippet.attributes?.find((a) => a.name === "label:textSnippetDescription");
        expect(descriptor?.type).toBe("label");
        expect(descriptor?.value).toContain("promoted");
        expect(descriptor?.value).toContain("single");
        expect(descriptor?.value).toContain("text");
    });

    it("applies the shared hidden-subtree label on the templates that hide their subtree", () => {
        const templates = buildHiddenSubtreeTemplates();
        const hidingIds = ["_template_calendar", "_template_table", "_template_geo_map", "_template_board"];

        for (const id of hidingIds) {
            const item = childById(templates, id);
            const attr = item.attributes?.find((a) => a.name === "subtreeHidden");
            expect(attr, id).toBeDefined();
            expect(attr?.type, id).toBe("label");
            expect(attr?.value, id).toBe("false");
        }

        // The list/grid views intentionally do NOT hide their subtree.
        for (const id of ["_template_list_view", "_template_grid_view"]) {
            const item = childById(templates, id);
            expect(item.attributes?.some((a) => a.name === "subtreeHidden"), id).toBe(false);
        }
    });

    it("declares the calendar's inheritable promoted date/time attributes", () => {
        const templates = buildHiddenSubtreeTemplates();
        const calendar = childById(templates, "_template_calendar");

        for (const name of ["label:startDate", "label:endDate", "label:startTime", "label:endTime"]) {
            const attr = calendar.attributes?.find((a) => a.name === name);
            expect(attr, name).toBeDefined();
            expect(attr?.isInheritable, name).toBe(true);
            expect(attr?.value, name).toContain("promoted");
        }
    });

    it("builds the board template with three seeded child notes carrying status labels", () => {
        const templates = buildHiddenSubtreeTemplates();
        const board = childById(templates, "_template_board");

        const statusDefinition = board.attributes?.find((a) => a.name === "label:status");
        expect(statusDefinition?.isInheritable).toBe(true);

        const childIds = (board.children ?? []).map((c) => c.id);
        expect(childIds).toEqual([
            "_template_board_first",
            "_template_board_second",
            "_template_board_third"
        ]);

        for (const child of board.children ?? []) {
            expect(child.type).toBe("text");
            const statusLabel = child.attributes?.find((a) => a.name === "status");
            expect(statusLabel?.type, child.id).toBe("label");
            expect(statusLabel?.value, child.id).toBeTruthy();
        }
    });

    it("wires the presentation template to its slide template via a child:template relation", () => {
        const templates = buildHiddenSubtreeTemplates();
        const presentation = childById(templates, "_template_presentation");

        const childTemplate = presentation.attributes?.find((a) => a.name === "child:template");
        expect(childTemplate?.type).toBe("relation");
        expect(childTemplate?.value).toBe("_template_presentation_slide");

        const slideChildIds = (presentation.children ?? []).map((c) => c.id);
        expect(slideChildIds).toEqual([
            "_template_presentation_first",
            "_template_presentation_second"
        ]);

        for (const slide of presentation.children ?? []) {
            expect(slide.type).toBe("text");
            const templateRelation = slide.attributes?.find((a) => a.name === "template");
            expect(templateRelation?.type, slide.id).toBe("relation");
            expect(templateRelation?.value, slide.id).toBe("_template_presentation_slide");
        }
    });

    it("exposes the presentation slide template with a promoted background color attribute", () => {
        const templates = buildHiddenSubtreeTemplates();
        const slide = childById(templates, "_template_presentation_slide");

        expect(slide.type).toBe("text");
        expect(slide.attributes?.some((a) => a.name === "slide")).toBe(true);

        const background = slide.attributes?.find((a) => a.name === "label:slide:background");
        expect(background?.type).toBe("label");
        expect(background?.value).toContain("color");
    });

    it("returns a fresh independent structure on each invocation", () => {
        const first = buildHiddenSubtreeTemplates();
        const second = buildHiddenSubtreeTemplates();

        expect(first).not.toBe(second);
        expect(first.children).not.toBe(second.children);
        expect(first.children?.length).toBe(second.children?.length);
    });
});
