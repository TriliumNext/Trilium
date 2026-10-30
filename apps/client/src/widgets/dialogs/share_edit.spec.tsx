import { describe, expect, it } from "vitest";

import { buildShareEditSettings } from "./share_edit";

describe("buildShareEditSettings", () => {
    it("opens editing to anyone with the link, or with a password of at least 4 characters", () => {
        expect(buildShareEditSettings("open", null)).toEqual({ enabled: true, open: true });
        expect(buildShareEditSettings("open", "secret")).toEqual({ enabled: true, open: true });
        expect(buildShareEditSettings("password", null)).toBeNull();
        expect(buildShareEditSettings("password", "abc")).toBeNull();
        expect(buildShareEditSettings("password", "abcd")).toEqual({ enabled: true, password: "abcd" });
    });
});
