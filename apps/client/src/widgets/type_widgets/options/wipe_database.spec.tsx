import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reloadFrontendApp } = vi.hoisted(() => ({
    reloadFrontendApp: vi.fn()
}));

// `server` is already globally mocked in the client test setup; here we only override
// reloadFrontendApp so the success path doesn't actually reload the page.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    reloadFrontendApp
}));

// Render a lightweight stand-in for the bootstrap-backed Modal so the test exercises the wipe
// dialog's own logic (countdown + confirm) without pulling in jQuery/bootstrap.
vi.mock("../../react/Modal", () => ({
    default: ({ show, children, footer }: { show: boolean; children: unknown; footer: unknown }) =>
        show ? <div className="mock-modal">{children}{footer}</div> : null
}));

import server from "../../../services/server";
import WipeDatabaseOptions from "./wipe_database";

const post = vi.spyOn(server, "post");

let container: HTMLDivElement | undefined;

async function openDialog() {
    const target = document.createElement("div");
    document.body.appendChild(target);
    container = target;
    await act(async () => {
        render(<WipeDatabaseOptions />, target);
    });
    // Open the confirmation dialog.
    await act(async () => {
        document.body.querySelector<HTMLButtonElement>(".wipe-database-button")?.click();
    });
}

function confirmButton() {
    return document.body.querySelector<HTMLButtonElement>(".wipe-database-confirm-button");
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    post.mockReset();
    reloadFrontendApp.mockReset();
});

describe("WipeDatabaseOptions", () => {
    it("keeps the confirm button disabled until the countdown elapses", async () => {
        await openDialog();

        // Immediately after opening, the destructive button is gated by the countdown.
        expect(confirmButton()?.disabled).toBe(true);

        // Half-way through, it is still disabled.
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(confirmButton()?.disabled).toBe(true);

        // Once the full delay has elapsed, it becomes actionable.
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(confirmButton()?.disabled).toBe(false);
    });

    it("posts the wipe request with the confirmation token and reloads on success", async () => {
        post.mockResolvedValue({ success: true });
        await openDialog();

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        await act(async () => { confirmButton()?.click(); });

        expect(post).toHaveBeenCalledOnce();
        expect(post.mock.calls[0][0]).toBe("database/wipe?really=yesIReallyWantToDeleteEverythingAndCannotUndoThis");
        expect(reloadFrontendApp).toHaveBeenCalledOnce();
    });

    it("does not reload if the wipe request fails", async () => {
        post.mockResolvedValue({ success: false });
        await openDialog();

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        await act(async () => { confirmButton()?.click(); });

        expect(post).toHaveBeenCalledOnce();
        expect(reloadFrontendApp).not.toHaveBeenCalled();
    });
});
