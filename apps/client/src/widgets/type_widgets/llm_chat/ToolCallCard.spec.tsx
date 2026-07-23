import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Uninitialized i18n returns undefined; echo the key so labels are assertable.
vi.mock("../../../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n.js")>()),
    t: (key: string) => key
}));

// Note links resolve titles through froca — irrelevant for approval rendering.
vi.mock("../../react/NoteLink.js", () => ({ NewNoteLink: () => null }));
vi.mock("react-i18next", () => ({ Trans: () => null }));

import type { ToolCall } from "./llm_chat_types.js";
import ToolCallCard from "./ToolCallCard.js";

function pendingToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        id: "tc1",
        toolName: "create_note",
        input: { title: "T" },
        requiresApproval: true,
        ...overrides
    };
}

describe("ToolCallCard approval UI", () => {
    let host: HTMLDivElement | undefined;

    function mount(toolCalls: ToolCall[], onApprove?: (id: string) => Promise<void>, onReject?: (id: string) => void) {
        host = document.createElement("div");
        document.body.appendChild(host);
        render(<ToolCallCard toolCalls={toolCalls} onApprove={onApprove} onReject={onReject} />, host);
        return host;
    }

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
    });

    it("shows the approval prompt with Approve/Reject buttons for a pending mutating call", () => {
        const el = mount([pendingToolCall()], vi.fn(async () => {}), vi.fn());

        expect(el.textContent).toContain("llm_chat.pending_approval");
        const labels = [...el.querySelectorAll("button")].map(b => b.textContent?.trim());
        expect(labels).toContain("llm_chat.approve");
        expect(labels).toContain("llm_chat.reject");
        // Pending sections are highlighted and auto-expanded.
        expect(el.querySelector(".llm-chat-tool-call-pending")).not.toBeNull();
        expect(el.querySelector("details.expandable-section")?.hasAttribute("open")).toBe(true);
    });

    it("invokes the handlers with the tool call id", async () => {
        const onApprove = vi.fn(async () => {});
        const onReject = vi.fn();
        const el = mount([pendingToolCall()], onApprove, onReject);

        const buttons = [...el.querySelectorAll("button")];
        const approveBtn = buttons.find(b => b.textContent?.includes("llm_chat.approve"))!;
        const rejectBtn = buttons.find(b => b.textContent?.includes("llm_chat.reject"))!;

        await act(async () => { approveBtn.click(); });
        expect(onApprove).toHaveBeenCalledWith("tc1");

        await act(async () => { rejectBtn.click(); });
        expect(onReject).toHaveBeenCalledWith("tc1");
    });

    it("renders no approval prompt without handlers or once a result exists", () => {
        const withoutHandlers = mount([pendingToolCall()]);
        expect(withoutHandlers.textContent).not.toContain("llm_chat.approve");
        render(null, withoutHandlers);

        const el = mount([pendingToolCall({ result: "done" })], vi.fn(async () => {}), vi.fn());
        expect(el.textContent).not.toContain("llm_chat.pending_approval");
    });

    it("renders the rejected state instead of the approval prompt", () => {
        const el = mount([pendingToolCall({ rejected: true })], vi.fn(async () => {}), vi.fn());

        expect(el.textContent).toContain("llm_chat.rejected_by_user");
        expect(el.textContent).not.toContain("llm_chat.pending_approval");
    });
});
