import { afterEach, describe, expect, it, vi } from "vitest";

import server from "../services/server";
import toast from "../services/toast";

import { showOAuthEnrollmentResultToast } from "./startup_checks";

vi.mock("../services/server", () => ({ default: { get: vi.fn() } }));
vi.mock("../services/toast", () => ({ default: { showMessage: vi.fn() } }));
// Echo interpolation values so assertions can verify the resolved account/provider.
vi.mock("../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)
}));

const serverGet = vi.mocked(server.get);
const showMessage = vi.mocked(toast.showMessage);

function setGlob(glob: Record<string, unknown> | undefined) {
    (window as unknown as { glob?: unknown }).glob = glob;
}

describe("showOAuthEnrollmentResultToast", () => {
    afterEach(() => {
        vi.clearAllMocks();
        setGlob(undefined);
    });

    it("toasts the connected account/provider when the bootstrap reports a fresh enrollment", async () => {
        setGlob({ oauthJustEnrolled: true });
        serverGet.mockResolvedValue({ email: "alice@example.com", issuerName: "Acme" });

        await showOAuthEnrollmentResultToast();

        expect(serverGet).toHaveBeenCalledWith("oauth/status");
        const message = showMessage.mock.calls[0]?.[0];
        expect(message).toContain("oauth_connect_success");
        expect(message).toContain("alice@example.com");
        expect(message).toContain("Acme");
    });

    it("falls back to a generic message when the status probe fails", async () => {
        setGlob({ oauthJustEnrolled: true });
        serverGet.mockRejectedValue(new Error("network down"));

        await showOAuthEnrollmentResultToast();

        expect(showMessage).toHaveBeenCalledWith("multi_factor_authentication.oauth_connect_success_generic");
    });

    it("does nothing without the bootstrap flag", async () => {
        setGlob({});
        await showOAuthEnrollmentResultToast();

        setGlob(undefined);
        await showOAuthEnrollmentResultToast();

        expect(serverGet).not.toHaveBeenCalled();
        expect(showMessage).not.toHaveBeenCalled();
    });
});
