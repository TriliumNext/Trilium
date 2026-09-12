import { OptionDefinitions } from "@triliumnext/commons";
import FormTextBox from "../../../react/FormTextBox";
import FormSelect from "../../../react/FormSelect";
import { useEffect, useMemo, useState } from "preact/hooks";
import { t } from "../../../../services/i18n";
import { useTriliumOption } from "../../../react/hooks";
import toast from "../../../../services/toast";

type TimeSelectorScale = "seconds" | "minutes" | "hours" | "days";

interface TimeSelectorProps {
    id?: string;
    name: string;
    optionValueId: keyof OptionDefinitions;
    optionTimeScaleId: keyof OptionDefinitions;
    includedTimeScales?: Set<TimeSelectorScale>;
    minimumSeconds?: number;
}

interface TimeScaleInfo {
    value: string;
    unit: string;
}

export default function TimeSelector({ id, name, includedTimeScales, optionValueId, optionTimeScaleId, minimumSeconds }: TimeSelectorProps) {
    const values = useMemo(() => {
        const values: TimeScaleInfo[] = [];
        const timeScalesWithDefault = includedTimeScales ?? new Set(["seconds", "minutes", "hours", "days"]);

        if (timeScalesWithDefault.has("seconds")) {
            values.push({ value: "1", unit: t("duration.seconds") });
            values.push({ value: "60", unit: t("duration.minutes") });
            values.push({ value: "3600", unit: t("duration.hours") });
            values.push({ value: "86400", unit: t("duration.days") });
        }
        return values;
    }, [ includedTimeScales ]);

    const [ storedValue, setValue ] = useTriliumOption(optionValueId);
    const [ storedScale, setScale ] = useTriliumOption(optionTimeScaleId);
    const [ displayedTime, setDisplayedTime ] = useState("");

    // An option that has never been written answers with an empty string, which is no duration at
    // all — and `convertTime` rightly refuses one. Read as zero seconds instead, so a row whose
    // option is missing still draws and the first edit stores something real, rather than the whole
    // page going down over a setting nobody has touched yet.
    const seconds = toWholeNumber(storedValue, 0);
    const scale = String(toWholeNumber(storedScale, 1, 1));

    // React to changes in scale and value.
    useEffect(() => {
        const newTime = convertTime(seconds, scale).toDisplay();
        setDisplayedTime(String(newTime));
    }, [ seconds, scale ]);

    return (
        <div class="d-flex gap-2">
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
                        setValue(minimumSecondsOrDefault);
                        return;
                    }

                    setValue(newTime);
                }}
            />

            <FormSelect
                values={values}
                keyProperty="value" titleProperty="unit"
                style={{ width: "auto" }}
                currentValue={scale} onChange={setScale}
            />
        </div>
    )
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