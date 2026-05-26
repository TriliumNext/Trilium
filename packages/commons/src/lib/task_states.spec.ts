import { describe, expect, it } from "vitest";

import { DONE_TASK_STATE, NONE_TASK_STATE, type TaskStateDef, type TaskStateValidationReason, validateTaskStates } from "./task_states.js";

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
});
