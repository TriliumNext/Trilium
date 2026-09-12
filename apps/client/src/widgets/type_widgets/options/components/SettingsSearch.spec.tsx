import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import { renderInto } from "../../../../test/render";
import SettingsSearch from "./SettingsSearch";

describe("SettingsSearch", () => {
    it("carries what is being looked for, and offers to clear it only once there is text", () => {
        const onChange = vi.fn();

        const empty = renderInto(<SettingsSearch query="" onChange={onChange} onFocus={vi.fn()} />);
        expect(empty.querySelector("input")?.value).toBe("");
        expect(empty.querySelector(".settings-search-clear")).toBeNull();

        const filled = renderInto(
            <SettingsSearch query="backup" onChange={onChange} onFocus={vi.fn()} />
        );
        expect(filled.querySelector("input")?.value).toBe("backup");

        filled.querySelector<HTMLButtonElement>(".settings-search-clear")?.click();
        expect(onChange).toHaveBeenCalledWith("");
    });

    it("reports what is typed, and the focus that opens the search", () => {
        const onChange = vi.fn();
        const onFocus = vi.fn();
        const input = renderInto(
            <SettingsSearch query="" onChange={onChange} onFocus={onFocus} />
        ).querySelector("input");

        // preact/compat delegates focus to focusin, the same way it does blur to focusout.
        input?.dispatchEvent(new Event("focusin", { bubbles: true }));
        expect(onFocus).toHaveBeenCalledTimes(1);

        if (input) input.value = "theme";
        input?.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("theme", expect.anything());
    });
});
