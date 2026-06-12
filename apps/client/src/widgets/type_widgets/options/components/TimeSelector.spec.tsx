import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../../../test/render";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

vi.mock("../../../../services/toast", () => ({
    default: { showError: vi.fn() }
}));

import options from "../../../../services/options";
import server from "../../../../services/server";
import toast from "../../../../services/toast";
import TimeSelector from "./TimeSelector";

// --- Render harness -------------------------------------------------------------------------------

function renderSelector(vnode: preact.ComponentChild) {
    return renderComponent(vnode).container;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

function numberInput(root: HTMLElement) {
    const input = root.querySelector<HTMLInputElement>("input[type=number]");
    if (!input) {
        throw new Error("expected a number input");
    }
    return input;
}

function select(root: HTMLElement) {
    const el = root.querySelector("select");
    if (!el) {
        throw new Error("expected a select");
    }
    return el;
}

/** Set the input value and validity, then fire the Preact-delegated `input` event. */
function typeInto(input: HTMLInputElement, value: string, valid = true) {
    input.value = value;
    Object.defineProperty(input, "validity", {
        configurable: true,
        get: () => ({ valid }) as ValidityState
    });
    act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(() => {
    setOptions({});
    vi.clearAllMocks();
});

describe("TimeSelector", () => {
    it("renders a number input and a select, converting the stored value to display units", () => {
        // 3600 seconds at scale 3600 (hours) -> 1 hour displayed.
        setOptions({ revisionSnapshotTimeInterval: "3600", revisionSnapshotTimeIntervalTimeScale: "3600" });
        const root = renderSelector(
            <TimeSelector
                id="rs-interval"
                name="rsInterval"
                optionValueId="revisionSnapshotTimeInterval"
                optionTimeScaleId="revisionSnapshotTimeIntervalTimeScale"
            />
        );

        const input = numberInput(root);
        expect(input.id).toBe("rs-interval");
        expect(input.getAttribute("name")).toBe("rsInterval");
        expect(input.getAttribute("min")).toBe("0");
        expect(input.getAttribute("step")).toBe("1");
        expect(input.value).toBe("1");

        const sel = select(root);
        // Four units (seconds/minutes/hours/days) when "seconds" scale is included (the default set).
        const optionValues = Array.from(sel.querySelectorAll("option")).map(o => o.value);
        expect(optionValues).toEqual([ "1", "60", "3600", "86400" ]);
    });

    it("renders an empty option list when the included scales do not contain 'seconds'", () => {
        setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "60" });
        const root = renderSelector(
            <TimeSelector
                name="pst"
                optionValueId="protectedSessionTimeout"
                optionTimeScaleId="protectedSessionTimeoutTimeScale"
                includedTimeScales={new Set([ "minutes", "hours" ])}
            />
        );

        // 600s at scale 60 (minutes) -> 10 displayed.
        expect(numberInput(root).value).toBe("10");
        // The component only emits options when the set has "seconds"; otherwise it is empty.
        expect(select(root).querySelectorAll("option").length).toBe(0);
    });

    it("saves the converted value (display * scale) when a valid value is entered", async () => {
        setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "60" });
        const root = renderSelector(
            <TimeSelector
                name="pst"
                optionValueId="protectedSessionTimeout"
                optionTimeScaleId="protectedSessionTimeoutTimeScale"
                minimumSeconds={60}
            />
        );

        // Enter 5 (minutes) -> 5 * 60 = 300 seconds.
        typeInto(numberInput(root), "5");
        await act(async () => {});

        expect(toast.showError).not.toHaveBeenCalled();
        expect(server.put).toHaveBeenCalledWith("options", { protectedSessionTimeout: 300 });
        // options.save stores the raw (numeric) value passed by the component.
        expect(options.get("protectedSessionTimeout" as OptionNames)).toBe(300 as unknown as string);
    });

    it("shows an error and does not save when the input is invalid", () => {
        setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "60" });
        const root = renderSelector(
            <TimeSelector
                name="pst"
                optionValueId="protectedSessionTimeout"
                optionTimeScaleId="protectedSessionTimeoutTimeScale"
            />
        );

        typeInto(numberInput(root), "abc", false);

        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(server.put).not.toHaveBeenCalled();
    });

    it("warns when the entered value falls below minimumSeconds", async () => {
        setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "60" });
        const root = renderSelector(
            <TimeSelector
                name="pst"
                optionValueId="protectedSessionTimeout"
                optionTimeScaleId="protectedSessionTimeoutTimeScale"
                minimumSeconds={120}
            />
        );

        // 1 minute -> 60 seconds, below the 120s minimum -> the below-minimum branch fires the error.
        typeInto(numberInput(root), "1");
        await act(async () => {});

        expect(toast.showError).toHaveBeenCalledTimes(1);
        // The component saves the already-computed converted value (60) and still warns.
        expect(server.put).toHaveBeenCalledWith("options", { protectedSessionTimeout: 60 });
    });

    it("clamps to the default minimum of zero when no minimumSeconds is supplied", async () => {
        // Use the FormTextBox min={0} so an entered 0 stays 0; convertTime(0) -> 0 which is >= default min 0.
        setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "60" });
        const root = renderSelector(
            <TimeSelector
                name="pst"
                optionValueId="protectedSessionTimeout"
                optionTimeScaleId="protectedSessionTimeoutTimeScale"
            />
        );

        typeInto(numberInput(root), "0");
        await act(async () => {});

        // 0 minutes -> 0 seconds; not NaN and not below the default minimum (0), so it is saved as-is.
        expect(toast.showError).not.toHaveBeenCalled();
        expect(server.put).toHaveBeenCalledWith("options", { protectedSessionTimeout: 0 });
    });

    it("recomputes the displayed value when the scale changes", () => {
        // 3600 seconds; start at scale 60 (minutes) -> 60 displayed.
        setOptions({ revisionSnapshotTimeInterval: "3600", revisionSnapshotTimeIntervalTimeScale: "60" });
        const root = renderSelector(
            <TimeSelector
                name="rsInterval"
                optionValueId="revisionSnapshotTimeInterval"
                optionTimeScaleId="revisionSnapshotTimeIntervalTimeScale"
            />
        );

        expect(numberInput(root).value).toBe("60");

        const sel = select(root);
        sel.value = "3600";
        act(() => {
            sel.dispatchEvent(new Event("change", { bubbles: true }));
        });

        // After switching to hours (3600), 3600 seconds -> 1 hour displayed.
        expect(numberInput(root).value).toBe("1");
        expect(server.put).toHaveBeenCalledWith("options", { revisionSnapshotTimeIntervalTimeScale: "3600" });
    });

    it("throws from convertTime when the stored value is not a valid integer", () => {
        // A non-numeric stored value -> parseInt(...) === NaN -> convertTime throws inside the effect.
        setOptions({ protectedSessionTimeout: "not-a-number", protectedSessionTimeoutTimeScale: "60" });
        expect(() =>
            renderSelector(
                <TimeSelector
                    name="pst"
                    optionValueId="protectedSessionTimeout"
                    optionTimeScaleId="protectedSessionTimeoutTimeScale"
                />
            )
        ).toThrow(/valid integer/);
    });

    it("throws from convertTime when the stored time scale is below one", () => {
        // A time scale of "0" -> operand < 1 -> convertTime throws inside the effect.
        setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "0" });
        expect(() =>
            renderSelector(
                <TimeSelector
                    name="pst"
                    optionValueId="protectedSessionTimeout"
                    optionTimeScaleId="protectedSessionTimeoutTimeScale"
                />
            )
        ).toThrow(/TimeScale needs to be a valid integer/);
    });
});
