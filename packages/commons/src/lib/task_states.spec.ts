import { describe, expect, it } from "vitest";

import { DEFAULT_TASK_STATES, DONE_STATE_NAME, DONE_TASK_STATE, isAnchorState, NONE_STATE_NAME, NONE_TASK_STATE, type TaskStateDef, type TaskStateValidationReason, validateTaskStates } from "./task_states.js";

function customState(overrides: Partial<TaskStateDef>): TaskStateDef {
    return {
        id: "_id",
        name: "doing",
        title: "Doing",
        markdownSymbol: "/",
        isCompleted: false,
        color: "",
        icon: "bx bx-loader",
        ...overrides
    };
}

describe("validateTaskStates", () => {
    it("keeps anchors and valid custom states", () => {
        const states = [NONE_TASK_STATE, customState({ id: "a", name: "doing" }), DONE_TASK_STATE];
        const { valid, errors } = validateTaskStates(states);

        expect(errors).toHaveLength(0);
        expect(valid).toEqual(states);
    });

    it("drops invalid custom states with the matching reason", () => {
        const scenarios: Array<[Partial<TaskStateDef>, TaskStateValidationReason]> = [
            [{ name: "" }, "undefined-name"],
            [{ name: "in progress" }, "invalid-name"],
            [{ name: "<b>" }, "invalid-name"],
            [{ name: "done" }, "duplicate-name"],
            [{ name: "none" }, "duplicate-name"],
            [{ title: "" }, "missing-title"],
            [{ icon: "" }, "missing-icon"],
            [{ markdownSymbol: "//" }, "invalid-symbol"],
            [{ markdownSymbol: " " }, "invalid-symbol"],
            [{ markdownSymbol: "[" }, "invalid-symbol"],
            [{ markdownSymbol: "X" }, "invalid-symbol"]
        ];

        for (const [overrides, reason] of scenarios) {
            const { valid, errors } = validateTaskStates([customState(overrides)]);
            expect(valid).toHaveLength(0);
            expect(errors).toHaveLength(1);
            expect(errors[0].reason).toBe(reason);
        }
    });

    it("detects duplicates across custom states, keeping the first", () => {
        const first = customState({ id: "a", name: "doing", markdownSymbol: "/" });
        const dupName = customState({ id: "b", name: "doing", markdownSymbol: "?" });
        const dupSymbol = customState({ id: "c", name: "other", markdownSymbol: "/" });

        const { valid, errors } = validateTaskStates([first, dupName, dupSymbol]);

        expect(valid).toEqual([first]);
        expect(errors.map((e) => e.reason)).toEqual(["duplicate-name", "duplicate-symbol"]);
    });

    it("reports the dropped state's id and title", () => {
        const { errors } = validateTaskStates([customState({ id: "abc", title: "My State", name: "" })]);
        expect(errors[0]).toEqual({ id: "abc", title: "My State", reason: "undefined-name" });
    });

    it("allows a custom state with no markdown symbol", () => {
        const { valid, errors } = validateTaskStates([customState({ markdownSymbol: "" })]);
        expect(errors).toHaveLength(0);
        expect(valid).toHaveLength(1);
    });

    it("falls back to empty id/title when the dropped state lacks them", () => {
        const { errors } = validateTaskStates([customState({ id: undefined, title: "", name: "" })]);
        expect(errors[0]).toEqual({ id: "", title: "", reason: "undefined-name" });
    });

    it("uses the name as the dropped state's title when the title is missing", () => {
        const { errors } = validateTaskStates([customState({ title: "", name: "in progress" })]);
        expect(errors[0]).toEqual({ id: "_id", title: "in progress", reason: "invalid-name" });
    });
});

describe("isAnchorState", () => {
    it("treats the built-in unchecked anchor as an anchor", () => {
        expect(isAnchorState("none")).toBe(true);
        expect(isAnchorState(NONE_STATE_NAME)).toBe(true);
    });

    it("treats the built-in checked anchor as an anchor", () => {
        expect(isAnchorState("done")).toBe(true);
        expect(isAnchorState(DONE_STATE_NAME)).toBe(true);
    });

    it("rejects customizable and empty state names", () => {
        expect(isAnchorState("doing")).toBe(false);
        expect(isAnchorState("")).toBe(false);
    });
});

describe("DEFAULT_TASK_STATES", () => {
    it("orders the states None, Doing, Done, Maybe, Cancelled", () => {
        expect(DEFAULT_TASK_STATES.map((state) => state.name)).toEqual([
            "none",
            "doing",
            "done",
            "maybe",
            "cancelled"
        ]);
    });
});
