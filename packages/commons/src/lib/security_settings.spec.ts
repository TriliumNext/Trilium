import { describe, expect, it } from "vitest";

import { parseSecuritySettings } from "./security_settings.js";

describe("what the security file says", () => {
    it("is every setting it named with a boolean", () => {
        expect(parseSecuritySettings(JSON.stringify({
            backendScriptingEnabled: true,
            sqlConsoleEnabled: false,
            allowLanAccess: true
        }))).toEqual({
            backendScriptingEnabled: true,
            sqlConsoleEnabled: false,
            allowLanAccess: true
        });
    });

    it("leaves out what it did not name, so the config file still gets a turn", () => {
        // Absent is not the same as `false` here: a server merges this over config.ini, and
        // answering for a setting the file never mentioned would silently override it.
        expect(parseSecuritySettings(`{"sqlConsoleEnabled": true}`)).toEqual({ sqlConsoleEnabled: true });
    });

    it("carries nothing it was not asked about", () => {
        const settings = parseSecuritySettings(JSON.stringify({
            backendScriptingEnabled: true,
            readOnly: true,
            instanceName: "elsewhere"
        }));

        expect(settings).toEqual({ backendScriptingEnabled: true });
    });

    // Only a literal boolean is an answer. Every one of these is what a forged or half-written file
    // looks like, and a `JSON.parse` that took them at face value would hand the string "false" to
    // a config field read as a boolean, where it is truthy.
    it.each([
        [ "a string", `{"backendScriptingEnabled": "true"}` ],
        [ "the string false, which is truthy", `{"backendScriptingEnabled": "false"}` ],
        [ "a number", `{"backendScriptingEnabled": 1}` ],
        [ "an object", `{"backendScriptingEnabled": {}}` ],
        [ "an array", `{"backendScriptingEnabled": [true]}` ],
        [ "null", `{"backendScriptingEnabled": null}` ],
        [ "a nested shape", `{"Security": {"backendScriptingEnabled": true}}` ],
        [ "not an object at all", `"backendScriptingEnabled"` ],
        [ "a bare true", `true` ],
        [ "an array of settings", `[{"backendScriptingEnabled": true}]` ],
        [ "not JSON", `backendScriptingEnabled=true` ],
        [ "half a file", `{"backendScriptingEnabled": tr` ],
        [ "nothing at all", `` ]
    ])("answers for nothing when it holds %s", (_case, contents) => {
        expect(parseSecuritySettings(contents)).toEqual({});
    });

    it("leaves the prototype alone when the file aims at it", () => {
        parseSecuritySettings(`{"__proto__": {"backendScriptingEnabled": true}}`);

        expect(({} as Record<string, unknown>).backendScriptingEnabled).toBeUndefined();
        expect(Object.prototype).not.toHaveProperty("backendScriptingEnabled");
    });
});
