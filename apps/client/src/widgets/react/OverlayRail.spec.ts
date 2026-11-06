import { describe, expect, it } from "vitest";

import { RailStand } from "./OverlayRail";

describe("RailStand", () => {
    it("shows the latest claimant and shows the previous one again when it goes", () => {
        const stand = new RailStand();
        const first = {};
        const second = {};
        expect(stand.isTaken).toBe(false);

        stand.claim(first);
        expect(stand.isTaken).toBe(true);
        expect(stand.isSuperseded(first)).toBe(false);

        stand.claim(second);
        expect(stand.isSuperseded(first)).toBe(true);
        expect(stand.isSuperseded(second)).toBe(false);

        stand.release(second);
        expect(stand.isSuperseded(first)).toBe(false);
        expect(stand.isTaken).toBe(true);

        stand.release(first);
        expect(stand.isTaken).toBe(false);
    });

    it("tells its listeners of a change, and only of a change", () => {
        const stand = new RailStand();
        const token = {};
        let told = 0;
        stand.subscribe(() => { told++; });

        stand.claim(token);
        stand.claim(token);
        stand.release(token);
        stand.release(token);

        expect(told).toBe(2);
    });
});
