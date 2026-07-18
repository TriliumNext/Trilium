import { describe, expect, it, vi } from "vitest";
import type i18next from "i18next";

import translationProvider from "./translation_provider.js";

describe("translationProvider", () => {
    it("wires up the HTTP backend and initializes i18next for the locale", async () => {
        const init = vi.fn().mockResolvedValue(undefined);
        const use = vi.fn().mockReturnValue({ init });
        const fakeInstance = { use } as unknown as typeof i18next;

        await translationProvider(fakeInstance, "en");

        expect(use).toHaveBeenCalledTimes(1);
        expect(init).toHaveBeenCalledTimes(1);

        const config = init.mock.calls[0][0];
        expect(config.lng).toBe("en");
        expect(config.fallbackLng).toBe("en");
        expect(config.ns).toBe("server");
        expect(config.returnEmptyString).toBe(false);
        expect(config.backend.loadPath).toContain("/{{lng}}/{{ns}}.json");
    });
});
