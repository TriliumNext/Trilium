import { describe, expect, it, vi } from "vitest";

import { calculateTaskProgress } from "./task_utils";

const todoItem = (label: string, checked = false) => `
    <li class="todo-list__item">
        <label class="todo-list__label">
            <input type="checkbox"${checked ? " checked=\"checked\"" : ""}>
            <span class="todo-list__label__description">${label}</span>
        </label>
    </li>
`;

describe("board task utilities", () => {
    it("calculates progress from CKEditor todo list HTML", () => {
        const progress = calculateTaskProgress(`
            <ul class="todo-list">
                ${todoItem("Done", true)}
                ${todoItem("Todo")}
                ${todoItem("Todo 2")}
            </ul>
        `);

        expect(progress).toEqual({ completed: 1, total: 3, percentage: 33 });
    });

    it("returns null for null, undefined, and empty content", () => {
        expect(calculateTaskProgress(null)).toBeNull();
        expect(calculateTaskProgress(undefined)).toBeNull();
        expect(calculateTaskProgress("")).toBeNull();
        expect(calculateTaskProgress("   ")).toBeNull();
    });

    it("returns null when content does not contain todo list items without parsing HTML", () => {
        const parseSpy = vi.spyOn(DOMParser.prototype, "parseFromString");

        expect(calculateTaskProgress("<p>No checklist here</p>")).toBeNull();

        expect(parseSpy).not.toHaveBeenCalled();
        parseSpy.mockRestore();
    });

    it("calculates 100% progress when all task items are complete", () => {
        const progress = calculateTaskProgress(`
            <ul class="todo-list">
                ${todoItem("Done 1", true)}
                ${todoItem("Done 2", true)}
            </ul>
        `);

        expect(progress).toEqual({ completed: 2, total: 2, percentage: 100 });
    });

    it("calculates 0% progress when no task items are complete", () => {
        const progress = calculateTaskProgress(`
            <ul class="todo-list">
                ${todoItem("Todo 1")}
                ${todoItem("Todo 2")}
            </ul>
        `);

        expect(progress).toEqual({ completed: 0, total: 2, percentage: 0 });
    });

    it("treats checked attribute variants as complete", () => {
        const progress = calculateTaskProgress(`
            <ul class="todo-list">
                <li class="todo-list__item"><label class="todo-list__label"><input type="checkbox" checked><span>Done 1</span></label></li>
                <li class="todo-list__item"><label class="todo-list__label"><input type="checkbox" checked=""><span>Done 2</span></label></li>
                <li class="todo-list__item"><label class="todo-list__label"><input type="checkbox" checked="checked"><span>Done 3</span></label></li>
                ${todoItem("Todo")}
            </ul>
        `);

        expect(progress).toEqual({ completed: 3, total: 4, percentage: 75 });
    });

    it("ignores checkboxes outside CKEditor todo list items", () => {
        const progress = calculateTaskProgress(`
            <input type="checkbox" checked>
            <ul>
                <li><label><input type="checkbox" checked>Unrelated checked list item</label></li>
            </ul>
            <ul class="todo-list">
                ${todoItem("Done", true)}
                ${todoItem("Todo")}
            </ul>
        `);

        expect(progress).toEqual({ completed: 1, total: 2, percentage: 50 });
    });
});
