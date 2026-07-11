import { describe, expect, it } from "vitest";

import { type AutoAdvanceNavigation, getAutoAdvanceTarget, MEDIA_PLAY_MODES, type MediaPlayMode, playModeFromLabel, playModeToLabel, shouldLoop } from "./media_play_mode";

describe("getAutoAdvanceTarget", () => {
    const nav = (index: number, total: number, nextId: string): AutoAdvanceNavigation => ({ index, total, nextId });

    it("advances to the following sibling when the parent is in play-next mode", () => {
        expect(getAutoAdvanceTarget("next", nav(1, 3, "b"))).toBe("b");
        expect(getAutoAdvanceTarget("next", nav(2, 3, "c"))).toBe("c");
    });

    it("stops at the last sibling instead of wrapping back to the first", () => {
        // nextId wraps to the first sibling here, but advancing must not loop the folder.
        expect(getAutoAdvanceTarget("next", nav(3, 3, "a"))).toBeNull();
    });

    it("does not advance unless the play mode is exactly \"next\"", () => {
        const navigation = nav(1, 3, "b");
        expect(getAutoAdvanceTarget(undefined, navigation)).toBeNull();
        expect(getAutoAdvanceTarget(null, navigation)).toBeNull();
        expect(getAutoAdvanceTarget("", navigation)).toBeNull();
        expect(getAutoAdvanceTarget("auto", navigation)).toBeNull();
        expect(getAutoAdvanceTarget("Next", navigation)).toBeNull();
    });

    it("does not advance when there is no sibling navigation (a lone item or none)", () => {
        expect(getAutoAdvanceTarget("next", null)).toBeNull();
    });
});

describe("playModeFromLabel", () => {
    it("maps the parent's label value to a mode", () => {
        expect(playModeFromLabel("loop")).toBe("loop");
        expect(playModeFromLabel("next")).toBe("next");
    });

    it("treats a missing or unrecognised label as play-once", () => {
        expect(playModeFromLabel(null)).toBe("once");
        expect(playModeFromLabel(undefined)).toBe("once");
        expect(playModeFromLabel("")).toBe("once");
        expect(playModeFromLabel("once")).toBe("once");
        expect(playModeFromLabel("bogus")).toBe("once");
    });
});

describe("playModeToLabel", () => {
    it("removes the label for play-once and writes the value otherwise", () => {
        expect(playModeToLabel("once")).toBeNull();
        expect(playModeToLabel("loop")).toBe("loop");
        expect(playModeToLabel("next")).toBe("next");
    });

    it("round-trips with playModeFromLabel for every mode", () => {
        for (const mode of MEDIA_PLAY_MODES) {
            expect(playModeFromLabel(playModeToLabel(mode))).toBe(mode);
        }
    });
});

describe("shouldLoop", () => {
    it("loops only in loop mode", () => {
        const looping: Record<MediaPlayMode, boolean> = { once: false, loop: true, next: false };
        for (const mode of MEDIA_PLAY_MODES) {
            expect(shouldLoop(mode)).toBe(looping[mode]);
        }
    });
});
