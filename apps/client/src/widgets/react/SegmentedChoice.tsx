import "./SegmentedChoice.css";

import clsx from "clsx";

import SimpleBadge from "./Badge";
import Button, { ButtonGroup } from "./Button";

export interface SegmentedChoiceOption<T extends string> {
    value: T;
    /** Left out where the option is shown as an icon alone, which then wants a {@link title}. */
    label?: string;
    /** An icon class without its `bx` prefix, e.g. `bx-square`. */
    icon?: string;
    /** What the option is called, for an option that shows as an icon alone. */
    title?: string;
    /**
     * How much the option holds, shown as a badge after its name.
     *
     * For a choice between views of the same things, where the size of the one not on show is part of
     * the decision to look at it — and where writing it into the label instead ("Yours (3)") reads as
     * part of the name rather than as a quantity. Zero is a count like any other and is shown: an
     * option offering nothing is worth saying so, and hiding it would leave the group's widths moving
     * as the last item goes.
     */
    count?: number;
}

interface SegmentedChoiceProps<T extends string> {
    options: SegmentedChoiceOption<T>[];
    /**
     * Kept a plain string rather than {@link T}: callers routinely hold the value as a raw option
     * string, and a value outside the options simply highlights nothing.
     */
    currentValue: string;
    onChange: (newValue: T) => void;
    className?: string;
}

/**
 * A row of buttons acting as one exclusive choice, the current one highlighted — for switching
 * between a few named views or sections where a dropdown would hide the alternatives.
 */
export default function SegmentedChoice<T extends string>({ options, currentValue, onChange, className }: SegmentedChoiceProps<T>) {
    return (
        <ButtonGroup size="sm" className={clsx("tn-segmented-choice", className)}>
            {options.map(({ value, label, icon, title, count }) => (
                <Button
                    key={value}
                    // Name and count share one inline box, rather than being two children of the
                    // button: the button is a flex row, so a badge left as a child of its own is laid
                    // out against the row's centre line instead of against the text, and lands a
                    // pixel above it. Inside a line box it aligns to the text itself, in the text's
                    // own units.
                    text={count !== undefined ? (
                        <span class="tn-segmented-choice-label">
                            {label}
                            <SimpleBadge className="tn-segmented-choice-count" title={count} />
                        </span>
                    ) : (label ?? "")}
                    icon={icon}
                    title={title}
                    size="small"
                    className={clsx(currentValue === value && "active")}
                    onClick={() => onChange(value)}
                />
            ))}
        </ButtonGroup>
    );
}
