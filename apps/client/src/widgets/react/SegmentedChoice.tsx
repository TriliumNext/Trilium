import "./SegmentedChoice.css";

import clsx from "clsx";

import { isMobile } from "../../services/utils";
import SimpleBadge from "./Badge";
import Button, { ButtonGroup } from "./Button";
import FormDropdownList from "./FormDropdownList";

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
    /** Turns the whole choice off, showing it as it stands but taking no press. */
    disabled?: boolean;
    /**
     * Fold the group into a dropdown on a mobile screen, where a row of named options runs out of
     * width and either wraps or pushes the row it sits in out of shape.
     *
     * Opt-in rather than automatic: a group of two or three icons is compact enough to keep its
     * segments anywhere, and hiding those behind a menu costs a press for nothing.
     */
    collapseOnMobile?: boolean;
}

/**
 * A row of buttons acting as one exclusive choice, the current one highlighted — for switching
 * between a few named views or sections where a dropdown would hide the alternatives.
 *
 * Where there is no room for the row — a mobile screen, with {@link SegmentedChoiceProps.collapseOnMobile}
 * set — the same choice is shown as a dropdown instead.
 */
export default function SegmentedChoice<T extends string>({ options, currentValue, onChange, className, disabled, collapseOnMobile }: SegmentedChoiceProps<T>) {
    if (collapseOnMobile && isMobile()) {
        return <CollapsedChoice options={options} currentValue={currentValue} onChange={onChange} className={className} disabled={disabled} />;
    }

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
                    disabled={disabled}
                    className={clsx(currentValue === value && "active")}
                    onClick={() => onChange(value)}
                />
            ))}
        </ButtonGroup>
    );
}

/**
 * The narrow rendering of a {@link SegmentedChoice}: the same options as one dropdown, labelled with
 * whichever is current.
 */
function CollapsedChoice<T extends string>({ options, currentValue, onChange, className, disabled }: Omit<SegmentedChoiceProps<T>, "collapseOnMobile">) {
    // An icon per line, or a check mark against the current one — a list mixing the two would show the
    // current option's icon replaced by the mark, which reads as the option having changed.
    const hasIcons = options.some(({ icon }) => icon);
    const values = options.map(({ value, label, icon, title, count }) => ({
        value,
        // An option that shows as an icon alone still needs its name once it is a line of text.
        label: label ?? title ?? value,
        icon: icon ? `bx ${icon}` : undefined,
        // A menu line has the width for the count beside the name, so it goes there as a plain suffix
        // rather than as the badge that keeps it legible against a button's own fill.
        count: count !== undefined ? String(count) : undefined
    }));

    return (
        <FormDropdownList
            className={className}
            values={values}
            keyProperty="value"
            titleProperty="label"
            titleSuffixProperty="count"
            iconProperty={hasIcons ? "icon" : undefined}
            currentValue={currentValue}
            onChange={(newValue) => onChange(newValue as T)}
            disabled={disabled}
            // A handful of options, so the menu never scrolls — see the prop's own note.
            noDropdownListStyle
            // This only ever renders on a phone, where a menu is a sheet from the bottom of the
            // screen rather than a box beside the control it belongs to.
            mobileBottomSheet
        />
    );
}
