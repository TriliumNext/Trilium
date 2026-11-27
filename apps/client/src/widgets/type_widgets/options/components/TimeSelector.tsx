import "./TimeSelector.css";

import { OptionDefinitions } from "@triliumnext/commons";
import { useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import toast from "../../../../services/toast";
import FormSelect from "../../../react/FormSelect";
import FormTextBox from "../../../react/FormTextBox";
import { useTriliumOption } from "../../../react/hooks/options";

export type TimeSelectorScale = "seconds" | "minutes" | "hours" | "days";

interface TimeSelectorProps {
    id?: string;
    name: string;
    optionValueId: keyof OptionDefinitions;
    optionTimeScaleId: keyof OptionDefinitions;
    includedTimeScales?: Set<TimeSelectorScale>;
    minimumSeconds?: number;
}

export interface ControlledTimeSelectorProps {
    id?: string;
    name: string;
    /** The duration, in seconds. */
    seconds: number;
    /** The seconds of the unit that the duration is shown in: `1`, `60`, `3600` or `86400`. */
    scale: string;
    onChange(seconds: number): void;
    onScaleChange(scale: string): void;
    includedTimeScales?: Set<TimeSelectorScale>;
    minimumSeconds?: number;
    maximumSeconds?: number;
}

interface TimeScaleInfo {
    value: string;
    unit: string;
}

const TIME_SCALES: { scale: TimeSelectorScale; value: string }[] = [
    { scale: "seconds", value: "1" },
    { scale: "minutes", value: "60" },
    { scale: "hours", value: "3600" },
    { scale: "days", value: "86400" }
];

/** A duration in a number box and a unit, both stored in options. */
export default function TimeSelector({
    optionValueId, optionTimeScaleId, ...props
}: TimeSelectorProps) {
    const [ storedValue, setValue ] = useTriliumOption(optionValueId);
    const [ storedScale, setScale ] = useTriliumOption(optionTimeScaleId);

    // An option that has never been written answers with an empty string, which is no duration at
    // all — and `convertTime` rightly refuses one. Read as zero seconds instead, so a row whose
    // option is missing still draws and the first edit stores something real, rather than the whole
    // page going down over a setting nobody has touched yet.
    return (
        <ControlledTimeSelector
            {...props}
            seconds={toWholeNumber(storedValue, 0)}
            scale={String(toWholeNumber(storedScale, 1, 1))}
            onChange={setValue}
            onScaleChange={setScale}
        />
    );
}

/** A duration in a number box and a unit, controlled by the caller. */
export function ControlledTimeSelector({
    id, name, seconds, scale, onChange, onScaleChange, includedTimeScales, minimumSeconds,
    maximumSeconds
}: ControlledTimeSelectorProps) {
    const values = useMemo<TimeScaleInfo[]>(() => TIME_SCALES
        .filter((timeScale) => !includedTimeScales || includedTimeScales.has(timeScale.scale))
        .map(({ scale: timeScale, value }) => ({ value, unit: t(`duration.${timeScale}`) })),
    [ includedTimeScales ]);
    const [ displayedTime, setDisplayedTime ] = useState("");

    // React to changes in scale and value.
    useEffect(() => {
        const newTime = convertTime(seconds, scale).toDisplay();
        setDisplayedTime(String(newTime));
    }, [ seconds, scale ]);

    return (
        <div className="time-selector">
            <FormTextBox
                id={id}
                name={name}
                type="number" min={0} step={1} required
                currentValue={displayedTime} onChange={(value, validity) => {
                    if (!validity.valid) {
                        toast.showError(t("time_selector.invalid_input"));
                        return false;
                    }

                    const time = parseInt(value, 10);
                    const minimumSecondsOrDefault = (minimumSeconds ?? 0);
                    // Converted only once there is a figure to convert: `convertTime` refuses
                    // anything else, so a check made past it could never be reached.
                    const newTime = Number.isNaN(time) ? null : convertTime(time, scale).toOption();

                    // Held up to the floor rather than merely complained about: the figure is
                    // stored in seconds, so that is what the floor is applied to.
                    if (newTime === null || newTime < minimumSecondsOrDefault) {
                        toast.showError(t("time_selector.minimum_input", { minimumSeconds: minimumSecondsOrDefault }));
                        onChange(minimumSecondsOrDefault);
                        return;
                    }

                    if (maximumSeconds !== undefined && newTime > maximumSeconds) {
                        toast.showError(t("time_selector.maximum_input", { maximumSeconds }));
                        onChange(maximumSeconds);
                        return;
                    }

                    onChange(newTime);
                }}
            />

            <FormSelect
                values={values}
                keyProperty="value" titleProperty="unit"
                currentValue={scale} onChange={onScaleChange}
            />
        </div>
    );
}

/**
 * Reads a stored option as a whole number, falling back where it holds nothing usable — an option
 * never written, or one carrying something that is not a figure at all.
 *
 * @param minimum the least the value may be; anything under it takes the fallback too.
 */
function toWholeNumber(stored: string, fallback: number, minimum?: number) {
    const parsed = parseInt(stored, 10);

    if (!Number.isFinite(parsed) || (minimum !== undefined && parsed < minimum)) {
        return fallback;
    }

    return parsed;
}

function convertTime(value: number, timeScale: string | number) {
    if (Number.isNaN(value)) {
        throw new Error(`Time needs to be a valid integer, but received: ${value}`);
    }

    const operand = typeof timeScale === "number" ? timeScale : parseInt(timeScale);
    if (Number.isNaN(operand) || operand < 1) {
        throw new Error(`TimeScale needs to be a valid integer >= 1, but received: ${timeScale}`);
    }

    return {
        toOption: () => Math.ceil(value * operand),
        toDisplay: () => Math.ceil(value / operand)
    };
}
