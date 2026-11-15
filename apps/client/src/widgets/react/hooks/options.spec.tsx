import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import options from "../../../services/options";
import { renderInto } from "../../../test/render";
import { useTriliumOption } from "./options";

const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../services/ws", () => ({ default: { logError } }));

describe("useTriliumOption", () => {
    it("logs a failed save and puts the previous value back", async () => {
        options.load({ theme: "light" });
        const save = vi.spyOn(options, "save").mockRejectedValue(new Error("Disk full"));

        let setTheme: ((value: string) => Promise<void>) | undefined;
        function Harness() {
            const [ theme, set ] = useTriliumOption("theme");
            setTheme = set;
            return <span>{theme}</span>;
        }
        const container = renderInto(<Harness />);
        expect(container.textContent).toBe("light");

        await act(async () => {
            await setTheme?.("dark");
        });

        expect(save).toHaveBeenCalledWith("theme", "dark");
        await vi.waitFor(() => expect(logError).toHaveBeenCalledWith("Disk full"));
        expect(container.textContent).toBe("light");
    });
});
