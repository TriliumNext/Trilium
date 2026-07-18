import { describe, expect, it, vi } from "vitest";

import { oauthAccountLabel, oauthProviderDisplayName } from "./oauth_status";

// t returns the key, so generic fallbacks surface as their translation key.
vi.mock("./i18n", () => ({ t: (key: string) => key }));

describe("oauthAccountLabel", () => {
    it("prefers email, falls back to name, then a generic label", () => {
        expect(oauthAccountLabel({ email: "a@example.com", name: "Alice" } as never)).toBe("a@example.com");
        expect(oauthAccountLabel({ name: "Alice" } as never)).toBe("Alice");
        expect(oauthAccountLabel({} as never)).toBe("multi_factor_authentication.oauth_account_unknown");
        expect(oauthAccountLabel(undefined)).toBe("multi_factor_authentication.oauth_account_unknown");
    });
});

describe("oauthProviderDisplayName", () => {
    it("prefers issuer name, falls back to the issuer URL host, then a generic label", () => {
        expect(oauthProviderDisplayName({ issuerName: "Acme", issuerUrl: "https://id.acme.com" } as never)).toBe("Acme");
        expect(oauthProviderDisplayName({ issuerUrl: "https://id.acme.com/realms/x" } as never)).toBe("id.acme.com");
        // A non-URL issuer string is returned as-is rather than throwing.
        expect(oauthProviderDisplayName({ issuerUrl: "not a url" } as never)).toBe("not a url");
        expect(oauthProviderDisplayName({} as never)).toBe("multi_factor_authentication.oauth_provider_unknown");
    });
});
