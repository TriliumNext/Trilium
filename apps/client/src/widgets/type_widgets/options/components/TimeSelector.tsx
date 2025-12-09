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

    const [ value, setValue ] = useTriliumOption(optionValueId);
    const [ scale, setScale ] = useTriliumOption(optionTimeScaleId);
    const [ displayedTime, setDisplayedTime ] = useState("");

    // React to changes in scale and value.
    useEffect(() => {
        const newTime = convertTime(parseInt(value, 10), scale).toDisplay();
        setDisplayedTime(String(newTime));
    }, [ value, scale ]);

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

                    let time = parseInt(value, 10);
                    const minimumSecondsOrDefault = (minimumSeconds ?? 0);
                    const newTime = convertTime(time, scale).toOption();

                    if (Number.isNaN(time) || newTime < (minimumSecondsOrDefault)) {
                        toast.showError(t("time_selector.minimum_input", { minimumSeconds: minimumSecondsOrDefault }));
                        time = minimumSecondsOrDefault;
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