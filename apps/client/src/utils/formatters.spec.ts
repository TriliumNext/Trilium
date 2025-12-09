import { describe, expect, it } from "vitest";
import options from "../services/options";
import { formatDateTime, normalizeLocale } from "./formatters";

describe("formatters", () => {
    it("tolerates incorrect locale", () => {
        options.set("formattingLocale", "cn_TW");

        expect(formatDateTime(new Date())).toBeTruthy();
        expect(formatDateTime(new Date(), "full", "none")).toBeTruthy();
        expect(formatDateTime(new Date(), "none", "full")).toBeTruthy();
    });

    it("normalizes locale", () => {
        expect(normalizeLocale("zh_CN")).toBe("zh-CN");
        expect(normalizeLocale("cn")).toBe("zh-CN");
        expect(normalizeLocale("tw")).toBe("zh-TW");
    });
});
