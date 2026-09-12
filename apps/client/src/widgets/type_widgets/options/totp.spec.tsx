import type { TOTPStatus } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    /** The per-code status the server answers with: a number is unused, a timestamp is spent. */
    const recovery: { keysExist: boolean; used: string[] } = { keysExist: false, used: [] };
    /** What each step of enrollment answers; a scenario overrides the one it is about. */
    const enrollment = { generated: true, verified: true, enabled: true };

    return {
        recovery,
        enrollment,
        get: vi.fn(async (url: string) => {
            if (url === "totp_recovery/enabled") return { success: true, keysExist: recovery.keysExist };
            if (url === "totp_recovery/used") return { success: true, usedRecoveryCodes: recovery.used };
            if (url === "totp/generate") {
                return enrollment.generated
                    ? { success: true, message: "JBSWY3DPEHPK3PXP", url: "otpauth://totp/Trilium" }
                    : { success: false };
            }
            if (url === "keyboard-actions") return [];
            return {};
        }),
        post: vi.fn(async (url: string) => {
            if (url === "totp/verify") {
                return enrollment.verified
                    ? { success: true, recoveryCodes: [ "aaaa-bbbb", "cccc-dddd" ] }
                    : { success: false };
            }
            if (url === "totp/enable") return { success: enrollment.enabled };
            return { success: true, recoveryCodes: [ "aaaa-bbbb", "cccc-dddd" ] };
        }),
        confirm: vi.fn(async () => true),
        showMessage: vi.fn(),
        showError: vi.fn(),
        refresh: vi.fn()
    };
});

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The recovery-codes dialog carries a `<Trans>`, which reads its catalogue from a React context that
// i18next never installs here.
vi.mock("react-i18next", () => ({ Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</> }));

/*
 * Stands in for the Bootstrap shell, keeping only what the wizard inside it is driven through: the
 * body, the footer, and submitting the form.
 *
 * The real one opens itself through jQuery and Bootstrap, neither of which happy-dom can carry — and
 * the failure is not confined to the dialog: it throws from an effect, which abandons the rest of
 * that flush, so the enrolment step's own effect never runs and no secret is ever requested.
 */
vi.mock("../../react/Modal", () => ({
    default: ({ className, show, footer, onSubmit, children }: {
        className?: string;
        show?: boolean;
        footer?: preact.ComponentChildren;
        onSubmit?: () => void;
        children?: preact.ComponentChildren;
    }) => (show
        ? <div className={`modal ${className ?? ""}`}>
            <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
                <div className="modal-body">{children}</div>
                <div className="modal-footer">{footer}</div>
            </form>
        </div>
        : null)
}));

vi.mock("../../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post, put: async () => ({}), remove: async () => ({}) }
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

// The two status helpers this file's `.ts` sibling covers are deliberately left to it.
import { TotpSettings } from "./totp";

let host: HTMLElement;

beforeEach(() => {
    mocks.recovery.keysExist = false;
    mocks.recovery.used = [];
    mocks.enrollment.generated = true;
    mocks.enrollment.verified = true;
    mocks.enrollment.enabled = true;
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

async function open(totpStatus?: TOTPStatus) {
    await act(async () => {
        render(null, host);
        render(<TotpSettings totpStatus={totpStatus} refreshTotpStatus={mocks.refresh} />, host);
    });
    // The codes arrive in two hops — whether any exist, and then which of them have been spent.
    await act(async () => {});
}

const badge = () => host.querySelector(".mfa-status-badge")?.className;
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[name='${name}']`);
const dots = () => [ ...host.querySelectorAll(".recovery-code-dot") ];

describe("TOTP before it has been set up", () => {
    it("offers the one way in, and says the method is off", async () => {
        await open({ set: false } as TOTPStatus);

        expect(badge()).toContain("inactive");
        expect(button("totp-setup-button")).not.toBeNull();
        // Recovery codes are part of TOTP and never exist without it.
        expect(button("regenerate-recovery-keys-button")).toBeNull();
        expect(button("totp-remove-button")).toBeNull();
    });
});

describe("TOTP once a secret is set", () => {
    beforeEach(() => {
        mocks.recovery.keysExist = true;
        // Two still available, one spent — the entries the server distinguishes by shape.
        mocks.recovery.used = [ "0", "2025-01-02 03:04:05", "2" ];
    });

    it("replaces the call to action with the codes panel, and says the method is on", async () => {
        await open({ set: true } as TOTPStatus);

        expect(badge()).toContain("active");
        expect(button("totp-setup-button")).toBeNull();
        expect(button("regenerate-recovery-keys-button")).not.toBeNull();
        expect(button("totp-remove-button")).not.toBeNull();
    });

    it("shows one dot per code, filled for the ones still to be spent", async () => {
        await open({ set: true } as TOTPStatus);

        expect(dots()).toHaveLength(3);
        expect(dots().filter((dot) => dot.className.includes("available"))).toHaveLength(2);
        expect(dots().filter((dot) => dot.className.includes("used"))).toHaveLength(1);
    });

    it("asks before minting a fresh batch, the old ones being lost either way", async () => {
        mocks.confirm.mockResolvedValueOnce(false);
        await open({ set: true } as TOTPStatus);

        await act(async () => button("regenerate-recovery-keys-button")?.click());
        expect(mocks.post).not.toHaveBeenCalled();

        await act(async () => button("regenerate-recovery-keys-button")?.click());
        expect(mocks.post).toHaveBeenCalledWith("totp_recovery/regenerate");
    });

    it("asks before removing TOTP, and refreshes the page's idea of it once gone", async () => {
        mocks.confirm.mockResolvedValueOnce(false);
        await open({ set: true } as TOTPStatus);

        await act(async () => button("totp-remove-button")?.click());
        expect(mocks.post).not.toHaveBeenCalled();

        await act(async () => button("totp-remove-button")?.click());
        expect(mocks.post).toHaveBeenCalledWith("totp/reset");
        expect(mocks.refresh).toHaveBeenCalled();
    });

    it("says so plainly when there are no codes at all, rather than showing an empty row of dots", async () => {
        mocks.recovery.keysExist = false;
        await open({ set: true } as TOTPStatus);

        expect(dots()).toHaveLength(0);
        const row = button("regenerate-recovery-keys-button")?.closest(".tn-card-option");
        expect(row?.querySelector(".tn-card-option-description")?.textContent)
            .toBe("multi_factor_authentication.recovery_keys_no_key_set");
    });
});

/**
 * The enrollment dialog, which persists nothing until it is finished: dismissing at any point has to
 * leave TOTP exactly as it was, so what each step does — and does not — commit is the whole of it.
 */
describe("enrolling in TOTP", () => {
    const dialog = () => document.querySelector(".totp-enrollment-modal");
    const secretBox = () => dialog()?.querySelector<HTMLInputElement>(".totp-enroll-secret");
    // The step holds two boxes: the secret, which is only ever read, and the code, which is typed.
    const codeBox = () => [ ...(dialog()?.querySelectorAll<HTMLInputElement>("input") ?? []) ]
        .find((input) => !input.readOnly);
    const footerButtons = () => [ ...(dialog()?.querySelectorAll<HTMLButtonElement>(".modal-footer button") ?? []) ];

    /** Opens the dialog and lets the secret it asks for arrive — requested as the step is shown. */
    async function startEnrolling() {
        await open({ set: false } as TOTPStatus);
        await act(async () => button("totp-setup-button")?.click());
        await act(async () => {});
        await act(async () => {});
    }

    /** Types a code and submits, which is what the verify step acts on. */
    async function enterCode(code: string) {
        await act(async () => {
            const box = codeBox();
            if (box) {
                box.value = code;
                box.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            dialog()?.querySelector<HTMLFormElement>("form")?.requestSubmit();
        });
        await act(async () => {});
    }

    it("shows the secret both ways it can be taken down: scanned, and read out to be typed", async () => {
        await startEnrolling();

        expect(dialog()?.querySelector(".totp-enroll-qr-code svg")).not.toBeNull();
        expect(secretBox()?.value).toBe("JBSWY3DPEHPK3PXP");
    });

    it("says so and commits nothing when the secret cannot even be had", async () => {
        mocks.enrollment.generated = false;
        await startEnrolling();

        expect(dialog()?.querySelector(".admonition")).not.toBeNull();
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it("keeps only digits, and no more of them than a code has", async () => {
        await startEnrolling();

        await act(async () => {
            const box = codeBox();
            if (box) {
                box.value = "12ab34cd5678";
                box.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });

        expect(codeBox()?.value).toBe("123456");
    });

    it("stays on the first step when the code is refused, clearing it to be typed again", async () => {
        mocks.enrollment.verified = false;
        await startEnrolling();
        await enterCode("000000");

        expect(mocks.post).toHaveBeenCalledWith("totp/verify", { secret: "JBSWY3DPEHPK3PXP", token: "000000" });
        // Nothing is stored by verifying, so a refusal leaves TOTP exactly as it was.
        expect(mocks.post).not.toHaveBeenCalledWith("totp/enable", expect.anything());
        expect(codeBox()?.value).toBe("");
        expect(dialog()?.querySelector(".totp-recovery-codes")).toBeNull();
    });

    it("moves on to the codes once the authenticator has proved itself, still committing nothing", async () => {
        await startEnrolling();
        await enterCode("123456");

        const codes = [ ...(dialog()?.querySelectorAll(".totp-recovery-codes li") ?? []) ];
        expect(codes.map((code) => code.textContent)).toEqual([ "aaaa-bbbb", "cccc-dddd" ]);
        expect(mocks.post).not.toHaveBeenCalledWith("totp/enable", expect.anything());
    });

    it("will not finish until the codes have been acknowledged as saved", async () => {
        await startEnrolling();
        await enterCode("123456");

        const [ finish ] = footerButtons();
        expect(finish.disabled).toBe(true);

        const acknowledge = dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']");
        await act(async () => void acknowledge?.click());
        expect(footerButtons()[0].disabled).toBe(false);
    });

    it("commits the secret and its codes together, in the one step that stores anything", async () => {
        await startEnrolling();
        await enterCode("123456");

        await act(async () => void dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']")?.click());
        await act(async () => footerButtons()[0].click());
        await act(async () => {});

        expect(mocks.post).toHaveBeenCalledWith("totp/enable", {
            secret: "JBSWY3DPEHPK3PXP",
            recoveryCodes: [ "aaaa-bbbb", "cccc-dddd" ]
        });
        expect(mocks.refresh).toHaveBeenCalled();
        expect(mocks.showMessage).toHaveBeenCalledWith("multi_factor_authentication.totp_enroll_enabled");
    });

    it("reports a refused commit rather than claiming TOTP is on", async () => {
        mocks.enrollment.enabled = false;
        await startEnrolling();
        await enterCode("123456");

        await act(async () => void dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']")?.click());
        await act(async () => footerButtons()[0].click());
        await act(async () => {});

        expect(mocks.showError).toHaveBeenCalledWith("multi_factor_authentication.totp_enroll_enable_error");
        expect(mocks.refresh).not.toHaveBeenCalled();
    });
});
