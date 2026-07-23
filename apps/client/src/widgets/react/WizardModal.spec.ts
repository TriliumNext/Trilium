import { describe, expect, it } from "vitest";

import { wizardNavigation } from "./WizardModal";

const STEPS = ["provider", "connection", "models"];

describe("wizardNavigation", () => {
    it("walks the steps, turning Back into Cancel at the start and Next into Finish at the end", () => {
        expect(wizardNavigation(STEPS, "provider")).toMatchObject({
            index: 0, previousStep: undefined, nextStep: "connection", position: 1, total: 3
        });
        expect(wizardNavigation(STEPS, "connection")).toMatchObject({
            index: 1, previousStep: "provider", nextStep: "models", position: 2, total: 3
        });
        expect(wizardNavigation(STEPS, "models")).toMatchObject({
            index: 2, previousStep: "connection", nextStep: undefined, position: 3, total: 3
        });
    });

    it("hides the steps before the entry step, which the user could never have walked to", () => {
        // Reopening a wizard over its own result: the earlier choices are fixed, so
        // Back must not offer them and the progress must not count them.
        expect(wizardNavigation(STEPS, "connection", "connection")).toMatchObject({
            previousStep: undefined, nextStep: "models", position: 1, total: 2
        });
        expect(wizardNavigation(STEPS, "models", "connection")).toMatchObject({
            previousStep: "connection", position: 2, total: 2
        });
        // A single reachable step: no Back, no progress to show (the component hides
        // the dots at a total of one), and the primary action finishes straight away.
        expect(wizardNavigation(STEPS, "models", "models")).toMatchObject({
            previousStep: undefined, nextStep: undefined, position: 1, total: 1
        });
    });

    it("clamps a step it cannot place instead of leaving the dialog with nothing to render", () => {
        // Unknown id, and an id before the entry step — both would otherwise index
        // past the ends of the list.
        expect(wizardNavigation(STEPS, "nonexistent")).toMatchObject({ index: 0, position: 1 });
        expect(wizardNavigation(STEPS, "nonexistent", "connection")).toMatchObject({ index: 1, position: 1 });
        expect(wizardNavigation(STEPS, "provider", "connection")).toMatchObject({
            index: 1, previousStep: undefined, position: 1
        });
        // An entry step that isn't in the list falls back to the first one.
        expect(wizardNavigation(STEPS, "connection", "nonexistent")).toMatchObject({ index: 1, previousStep: "provider", total: 3 });
    });

    it("survives a single step and an empty list", () => {
        expect(wizardNavigation(["only"], "only")).toMatchObject({
            index: 0, previousStep: undefined, nextStep: undefined, position: 1, total: 1
        });
        // Nothing to render; the component bails on the missing step rather than throwing.
        expect(wizardNavigation([], "whatever").index).toBe(0);
    });
});
