import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomPressureItem } from "./Handwriting";

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

describe("CustomPressureItem", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => render(null, host));

    it("puts the focus in its box when the row is picked, as Enter does from the keyboard", () => {
        render(<CustomPressureItem value={60} onChange={() => {}} />, host);
        const row = host.querySelector<HTMLElement>(".dropdown-item");
        const input = host.querySelector<HTMLInputElement>("input");
        if (!row || !input) throw new Error("expected the row and its box");

        row.click();
        expect(document.activeElement).toBe(input);
    });
});
