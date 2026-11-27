import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomPressureItem, InsertMenu } from "./Handwriting";

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

describe("InsertMenu", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => act(() => render(null, host)));

    it("offers an image and a PDF behind one button, each opening its own file chooser", async () => {
        const onImage = vi.fn();
        const onPdf = vi.fn();
        act(() => render(<InsertMenu onInsertImage={onImage} onInsertPdf={onPdf} />, host));

        const toggle = host.querySelector<HTMLButtonElement>(".tn-overlay-control-dropdown > button");
        expect(toggle?.getAttribute("aria-label")).toBe("handwriting.insert");
        expect(toggle?.classList.contains("bx-plus")).toBe(true);

        await act(async () => toggle?.click());
        const items = await vi.waitFor(() => {
            const found = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ];
            expect(found).toHaveLength(2);
            return found;
        });
        expect(items.map((item) => item.textContent?.trim())).toEqual([ "handwriting.insert_image", "handwriting.insert_pdf" ]);
        expect(items.map((item) => item.querySelector(".bx")?.classList.contains("bx-image-add") || item.querySelector(".bx")?.classList.contains("bxs-file-pdf")))
            .toEqual([ true, true ]);

        await act(async () => items[1].click());
        expect(onPdf).toHaveBeenCalledOnce();
        expect(onImage).not.toHaveBeenCalled();
    });
});
