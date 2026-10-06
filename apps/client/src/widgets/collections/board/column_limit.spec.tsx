import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import { ParentComponent } from "../../react/react_utils";
import BoardApi from "./api";
import ColumnLimitDialog from "./column_limit";

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve()
}));

describe("Setting how much a column should hold", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        vi.restoreAllMocks();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function open(limit: number | undefined) {
        const api = {
            getColumnLimit: () => limit,
            setColumnLimit: vi.fn(async () => {})
        } as unknown as BoardApi;

        const element = document.createElement("div");
        container = element;
        document.body.appendChild(element);
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <ColumnLimitDialog api={api} column="To Do" onClose={() => {}} />
                </ParentComponent.Provider>,
                element
            );
        });

        // The modal renders into the page rather than into the container it was given.
        return { api, dialog: document.querySelector<HTMLElement>(".board-column-limit-dialog") };
    }

    /** One row per setting, the label naming the control beside it. */
    it("puts each label beside the control it names", async () => {
        const { dialog } = await open(3);
        const fields = dialog?.querySelector(".board-column-limit-fields");

        expect(fields).not.toBeNull();
        expect([ ...fields?.children ?? [] ].map(el => el.tagName.toLowerCase()))
            .toEqual([ "label", "div", "label", "input" ]);
        // Each label points at the control it sits with, so the pair reads as one row. Scoped to
        // the grid's own children: the switch wraps itself in a label of its own.
        expect([ ...fields?.querySelectorAll(":scope > label") ?? [] ]
            .map(el => el.getAttribute("for")))
            .toEqual([ "board-column-limit-toggle", "board-column-limit-count" ]);
    });

    it("opens on what the column already holds itself to", async () => {
        const { dialog } = await open(3);

        expect(dialog?.querySelector<HTMLInputElement>(".switch-toggle")?.checked).toBe(true);
        expect(dialog?.querySelector<HTMLInputElement>("input[type=number]")?.value).toBe("3");
    });

    /**
     * The switch is what takes a limit away. A column holding no number is not a column meant to
     * hold none, which is what a zero would say.
     */
    it("offers a number to switch on for a column holding itself to none", async () => {
        const { dialog } = await open(undefined);

        expect(dialog?.querySelector<HTMLInputElement>(".switch-toggle")?.checked).toBe(false);
        expect(dialog?.querySelector<HTMLInputElement>("input[type=number]")?.disabled).toBe(true);
    });
});
