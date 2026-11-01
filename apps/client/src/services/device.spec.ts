import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveDevice } from "./device";

const signedIn = { device: false, dbInitialized: true, passwordSet: true, loggedIn: true } as const;
const loginScreen = { ...signedIn, loggedIn: false } as const;

function openAt(search: string) {
    window.history.replaceState(null, "", `/${search}`);
}

afterEach(() => {
    openAt("");
    document.cookie = "trilium-device=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("resolveDevice", () => {
    it("keeps the print device only when the print page renders", () => {
        const printPage = { ...signedIn, device: "print" } as const;
        expect(resolveDevice(printPage)).toBe("print");

        // A print link opened without a session shows the login screen, which needs the theme.
        expect(resolveDevice({ ...printPage, loggedIn: false })).not.toBe("print");
        expect(resolveDevice({ ...printPage, passwordSet: false })).not.toBe("print");
        expect(resolveDevice({ ...printPage, dbInitialized: false })).not.toBe("print");
    });

    it("keeps the reported screen device on the login screen", () => {
        expect(resolveDevice({ ...loginScreen, device: "mobile" })).toBe("mobile");
        expect(resolveDevice({ ...loginScreen, device: "desktop" })).toBe("desktop");
    });

    it("reads the device from the address when the server reports none", () => {
        openAt("?print");
        expect(resolveDevice(signedIn)).toBe("print");

        openAt("?print&mobile");
        expect(resolveDevice(loginScreen)).toBe("mobile");

        openAt("?print&desktop");
        expect(resolveDevice(loginScreen)).toBe("desktop");

        openAt("?mobile");
        expect(resolveDevice(signedIn)).toBe("mobile");
    });

    it("falls back to the device cookie, then to the screen and browser", () => {
        openAt("?print");
        document.cookie = "trilium-device=mobile";
        expect(resolveDevice(loginScreen)).toBe("mobile");
        document.cookie = "trilium-device=; expires=Thu, 01 Jan 1970 00:00:00 GMT";

        const coarse = (matches: boolean) => ({ media: "(pointer:coarse)", matches });
        vi.stubGlobal("matchMedia", () => coarse(true));
        expect(resolveDevice(loginScreen)).toBe("mobile");
        vi.stubGlobal("matchMedia", () => coarse(false));
        expect(resolveDevice(loginScreen)).toBe("desktop");

        // Without a pointer media query, the orientation API and then the user agent decide.
        vi.stubGlobal("matchMedia", undefined);
        vi.stubGlobal("orientation", 0);
        expect(resolveDevice(loginScreen)).toBe("mobile");
        delete (window as { orientation?: unknown }).orientation;
        const ua = vi.spyOn(navigator, "userAgent", "get");
        ua.mockReturnValue("Mozilla/5.0 (Linux; Android 15)");
        expect(resolveDevice(loginScreen)).toBe("mobile");
        ua.mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        expect(resolveDevice(loginScreen)).toBe("desktop");
    });
});
