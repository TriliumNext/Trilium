import { afterEach, describe, expect, it, vi } from "vitest";

import {
    asSetupTargetScreen,
    enterSetupMode,
    getSetupLanguage,
    getSetupPlatform,
    getSetupTargetScreen,
    hasExistingData,
    initSetupPlatform,
    isInitialSetup,
    isSetupRequested,
    leaveSetupMode,
    markExistingDataDiscarded,
    parseSetupMarker
} from "./setup_mode.js";

afterEach(() => leaveSetupMode());

describe("reading a marker", () => {
    it("takes the language and the screen it names", () => {
        expect(parseSetupMarker(`{ "lang": "ro", "targetScreen": "restore-backup" }`))
            .toEqual({ lang: "ro", targetScreen: "restore-backup" });
    });

    it("takes a marker that only says which language, which is the whole of what is required", () => {
        expect(parseSetupMarker(`{ "lang": "en" }`)).toEqual({ lang: "en" });
    });

    it("drops a screen it does not know, rather than carrying it", () => {
        // The wizard has states that create a document the moment they are shown. A file in the data
        // directory must not be able to name one, whoever wrote it.
        expect(parseSetupMarker(`{ "lang": "en", "targetScreen": "createNewDocumentEmpty" }`))
            .toEqual({ lang: "en" });
        expect(asSetupTargetScreen("createNewDocumentEmpty")).toBeUndefined();
        expect(asSetupTargetScreen("restore-backup")).toBe("restore-backup");
    });

    it("refuses anything that is not a marker", () => {
        // Read at the one moment when a wrong answer sends the instance somewhere nobody asked for.
        expect(parseSetupMarker("not json at all")).toBeNull();
        expect(parseSetupMarker(`{ "targetScreen": "restore-backup" }`)).toBeNull();
        expect(parseSetupMarker(`{ "lang": "" }`)).toBeNull();
        expect(parseSetupMarker(`{ "lang": 42 }`)).toBeNull();
        expect(parseSetupMarker(`[ "lang" ]`)).toBeNull();
        expect(parseSetupMarker("null")).toBeNull();
    });
});

describe("being in setup because it was asked for", () => {
    it("starts as neither, since an ordinary start has no marker", () => {
        expect(isSetupRequested()).toBe(false);
        expect(isInitialSetup()).toBe(true);
        expect(getSetupTargetScreen()).toBeUndefined();
        expect(getSetupLanguage()).toBeUndefined();
    });

    it("remembers what the marker asked for, and says this is not a first run", () => {
        enterSetupMode({ lang: "de", targetScreen: "restore-backup" });

        expect(isSetupRequested()).toBe(true);
        // Which is what lets a screen offer to leave: there is a database to go back to.
        expect(isInitialSetup()).toBe(false);
        expect(getSetupTargetScreen()).toBe("restore-backup");
        expect(getSetupLanguage()).toBe("de");
    });

    it("is left the moment a database is brought up", () => {
        enterSetupMode({ lang: "de" });
        leaveSetupMode();

        expect(isSetupRequested()).toBe(false);
        expect(isInitialSetup()).toBe(true);
    });

    it("treats a start without a marker as the ordinary one", () => {
        enterSetupMode(null);

        expect(isSetupRequested()).toBe(false);
        expect(isInitialSetup()).toBe(true);
    });
});

describe("whether there is still a knowledge base behind the wizard", () => {
    it("is what a marker means, until the wizard erases what the marker was about", () => {
        expect(hasExistingData()).toBe(false);

        enterSetupMode({ lang: "de" });
        expect(hasExistingData()).toBe(true);

        markExistingDataDiscarded();
        expect(hasExistingData()).toBe(false);
        // How it was reached does not change, which is a different question and a settled one.
        expect(isInitialSetup()).toBe(false);
        expect(isSetupRequested()).toBe(true);
    });

    it("comes back with the next start, since that one has a database of its own again", () => {
        enterSetupMode({ lang: "de" });
        markExistingDataDiscarded();
        leaveSetupMode();

        enterSetupMode({ lang: "de" });
        expect(hasExistingData()).toBe(true);
    });
});

describe("what setup reaches for on its platform", () => {
    it("carries what a route writes to whichever platform registered itself", async () => {
        const written: unknown[] = [];
        initSetupPlatform({
            writeMarker: async (marker) => { written.push(marker); },
            hasMarker: async () => written.length > 0,
            removeMarker: async () => {},
            removeDatabase: async () => {}
        });

        await getSetupPlatform().writeMarker({ lang: "en", targetScreen: "restore-backup" });
        expect(written).toEqual([ { lang: "en", targetScreen: "restore-backup" } ]);
    });

    it("says so rather than failing quietly where no platform registered one", async () => {
        vi.resetModules();
        const fresh = await import("./setup_mode.js");

        expect(() => fresh.getSetupPlatform()).toThrow(/not initialized/);
    });
});
