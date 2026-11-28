import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomPressureItem, EraserRail, InsertMenu } from "./Handwriting";

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

describe("EraserRail", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => act(() => render(null, host)));

    it("offers the two ways to erase, marks the one in use and switches to the other", () => {
        const onChange = vi.fn();
        act(() => render(<EraserRail mode="stroke" onChange={onChange} />, host));

        const buttons = [ ...host.querySelectorAll<HTMLButtonElement>(".handwriting-rail button") ];
        expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([ "handwriting.eraser_stroke", "handwriting.eraser_partial" ]);
        expect(buttons.map((button) => button.classList.contains("active"))).toEqual([ true, false ]);
        expect(buttons.every((button) => [ ...button.classList ].some((name) => name.startsWith("bx-")))).toBe(true);

        act(() => buttons[1].click());
        expect(onChange).toHaveBeenCalledExactlyOnceWith("partial");

        act(() => render(<EraserRail mode="partial" onChange={onChange} />, host));
        expect([ ...host.querySelectorAll(".handwriting-rail button") ].map((button) => button.classList.contains("active"))).toEqual([ false, true ]);
    });
});
