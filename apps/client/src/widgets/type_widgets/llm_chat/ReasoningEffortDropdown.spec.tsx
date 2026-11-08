import type { LlmModelInfo } from "@triliumnext/commons";
import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: { level?: string }) => (options?.level ? `${key}(${options.level})` : key)
}));

// Renders the toggle's face, its tooltip and class, and the menu, without Bootstrap.
vi.mock("../../react/Dropdown.js", () => ({
    default: ({ text, title, buttonClassName, children }: {
        text: ComponentChildren; title?: string; buttonClassName?: string; children: ComponentChildren;
    }) => (
        <div className="dropdown-stub">
            <button className={buttonClassName} title={title}>{text}</button>
            <div className="menu">{children}</div>
        </div>
    )
}));

import ReasoningEffortDropdown, { effectiveReasoningEffort } from "./ReasoningEffortDropdown.js";

const FLASH: LlmModelInfo = { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoningEfforts: [ "low", "medium", "high" ], defaultReasoningEffort: "high" };
const PRO: LlmModelInfo = { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", reasoningEfforts: [ "low", "high" ], defaultReasoningEffort: "high" };

let host: HTMLElement | undefined;

afterEach(() => {
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
});

function renderDropdown(model: LlmModelInfo, value: Parameters<typeof ReasoningEffortDropdown>[0]["value"], onChange = vi.fn()) {
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    act(() => render(<ReasoningEffortDropdown model={model} value={value} onChange={onChange} />, target));
    return { host: target, onChange };
}

describe("effectiveReasoningEffort", () => {
    it("uses the chat's level where the model has it, the model's default otherwise", () => {
        expect(effectiveReasoningEffort(FLASH, "medium")).toBe("medium");
        expect(effectiveReasoningEffort(PRO, "medium")).toBe("high");
        expect(effectiveReasoningEffort(PRO, undefined)).toBe("high");
        expect(effectiveReasoningEffort({ ...PRO, defaultReasoningEffort: undefined }, undefined)).toBe("high");
        expect(effectiveReasoningEffort({ ...FLASH, reasoningEfforts: [ "low", "medium" ], defaultReasoningEffort: undefined }, undefined)).toBe("medium");
        // A model that names no levels at all.
        expect(effectiveReasoningEffort({ id: "m", name: "M" }, "low")).toBe("high");
    });
});

describe("ReasoningEffortDropdown", () => {
    it("lists nothing for a model without levels", () => {
        const { host: plain } = renderDropdown({ id: "m", name: "M" }, undefined);
        expect(plain.querySelectorAll(".menu .dropdown-item")).toHaveLength(0);
    });

    it("lists the model's levels, ticks the one in effect and picks another", () => {
        const { host, onChange } = renderDropdown(PRO, "medium");

        // Only the levels: the toggle's tooltip already names the menu.
        expect(host.querySelector(".menu")?.children.length).toBe(2);
        const items = [ ...host.querySelectorAll<HTMLElement>(".menu .dropdown-item") ];
        expect(items.map(item => item.textContent?.trim())).toEqual([
            "llm_chat.reasoning_effort_levels.low",
            "llm_chat.reasoning_effort_levels.high"
        ]);
        // Medium on Pro runs at the nearest level it offers, High, which is ticked.
        expect(items.map(item => item.classList.contains("checked") || !!item.querySelector(".bx-check"))).toEqual([ false, true ]);
        expect(host.querySelector("button")?.title).toBe("llm_chat.reasoning_effort_title(llm_chat.reasoning_effort_levels.high)");

        act(() => items[0].click());
        expect(onChange).toHaveBeenCalledWith("low");
    });

    it("reads like the model picker: a combobox naming the level in effect", () => {
        const button = renderDropdown(FLASH, "low").host.querySelector("button");
        expect(button?.classList.contains("llm-chat-model-select")).toBe(true);
        expect(button?.textContent).toBe("llm_chat.reasoning_effort_levels.low");
        expect(button?.querySelector(".bx-brain")).not.toBeNull();
    });
});
