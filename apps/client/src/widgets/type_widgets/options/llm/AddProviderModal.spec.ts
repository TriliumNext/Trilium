import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

import {
    isConnectionValid,
    isValidBaseUrl,
    prefilledBaseUrl,
    PROVIDER_TYPES,
    type ProviderType
} from "./AddProviderModal";

const provider = (id: string) => PROVIDER_TYPES.find((type) => type.id === id);

describe("isValidBaseUrl", () => {
    it("accepts an empty field, which means the provider's own default stands", () => {
        expect(isValidBaseUrl("")).toBe(true);
    });

    it("accepts what can actually be reached over the wire, and nothing else", () => {
        expect(isValidBaseUrl("https://api.openai.com/v1")).toBe(true);
        expect(isValidBaseUrl("http://localhost:11434")).toBe(true);

        // Parses as a URL, but not one the app could ever request.
        expect(isValidBaseUrl("ftp://example.com")).toBe(false);
        expect(isValidBaseUrl("file:///etc/passwd")).toBe(false);
        // Not a URL at all — a host with no scheme is the usual slip.
        expect(isValidBaseUrl("localhost:11434")).toBe(false);
        expect(isValidBaseUrl("not a url")).toBe(false);
    });
});

describe("isConnectionValid", () => {
    const withModes = (apiKey: ProviderType["apiKey"], baseUrl: ProviderType["baseUrl"]) =>
        ({ apiKey, baseUrl } as ProviderType);

    it("wants a key from a provider that requires one, and counts blank as none", () => {
        const vendor = withModes("required", "advanced");

        expect(isConnectionValid(vendor, "", "")).toBe(false);
        expect(isConnectionValid(vendor, "   ", "")).toBe(false);
        expect(isConnectionValid(vendor, "sk-abc", "")).toBe(true);
    });

    it("treats a required key as the default, for a provider that says nothing about it", () => {
        expect(isConnectionValid(undefined, "", "")).toBe(false);
        expect(isConnectionValid(undefined, "sk-abc", "")).toBe(true);
    });

    it("wants an endpoint from a provider that has no default of its own", () => {
        const selfHosted = withModes("optional", "required");

        expect(isConnectionValid(selfHosted, "", "")).toBe(false);
        expect(isConnectionValid(selfHosted, "", "http://localhost:11434")).toBe(true);
        // A key is welcome but not required — a proxy in front of the endpoint may want one.
        expect(isConnectionValid(selfHosted, "sk-abc", "http://localhost:11434")).toBe(true);
    });

    it("refuses a malformed endpoint even where the field is only an override", () => {
        const vendor = withModes("required", "advanced");

        expect(isConnectionValid(vendor, "sk-abc", "localhost:11434")).toBe(false);
        expect(isConnectionValid(vendor, "sk-abc", "https://proxy.example.com")).toBe(true);
    });

    it("asks for nothing from a provider that authenticates elsewhere", () => {
        // Claude Code and the like: the subscription is signed in through its own program.
        expect(isConnectionValid(withModes("none", "none"), "", "")).toBe(true);
        // Even a field left in a mess cannot hold it up, there being no field.
        expect(isConnectionValid(withModes("none", "none"), "", "not a url")).toBe(true);
    });
});

describe("prefilledBaseUrl", () => {
    it("fills in an endpoint only where the port is the user's to get right", () => {
        // Self-hosted runtimes differ by port per install, so the default is written in.
        expect(prefilledBaseUrl("ollama")).toBe(provider("ollama")?.defaultBaseUrl);
        // A vendor's endpoint is a hint only, so an unedited field stores no override.
        expect(prefilledBaseUrl("openai")).toBe("");
        expect(prefilledBaseUrl("no-such-provider")).toBe("");
    });
});

describe("the provider list", () => {
    it("gives every provider what a card needs to be drawn", () => {
        for (const type of PROVIDER_TYPES) {
            expect(type.id, `${type.id} has an id`).toBeTruthy();
            expect(type.name, `${type.id} has a name`).toBeTruthy();
            expect(type.iconUrl, `${type.id} has an icon`).toBeTruthy();
        }
    });

    it("gives every provider an endpoint, bar the ones that are not reached over one", () => {
        for (const type of PROVIDER_TYPES) {
            // A subscription provider is driven through its own program, so there is no address to
            // offer and its card asks for none.
            const expected = type.baseUrl === "none" ? "" : expect.stringMatching(/^https?:\/\//);
            expect(type.defaultBaseUrl, `${type.id}'s endpoint`).toEqual(expected);
        }
    });

    it("keeps the ids apart, since the stored config is keyed by them", () => {
        const ids = PROVIDER_TYPES.map((type) => type.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("files every provider under a section the list actually renders", () => {
        const groups = new Set([ "cloud", "subscription", "local", "custom" ]);
        for (const type of PROVIDER_TYPES) {
            expect(groups, `${type.id} is filed somewhere`).toContain(type.group);
        }
    });

    it("prefills only the providers that run on the user's own machine", () => {
        for (const type of PROVIDER_TYPES.filter((candidate) => candidate.prefillBaseUrl)) {
            expect(type.baseUrl, `${type.id} asks for its endpoint`).toBe("required");
        }
    });
});
