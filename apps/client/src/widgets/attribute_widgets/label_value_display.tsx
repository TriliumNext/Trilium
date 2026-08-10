import "./label_value_display.css";

import { type LabelType } from "@triliumnext/commons";
import clsx from "clsx";

import { formatDateNumeric } from "../../utils/formatters";
import { safeUrlHref } from "../../utils/url";
import Icon from "../react/Icon";

/**
 * One stored label value as its type reads it: a date through the user's locale, a colour as its
 * swatch, a flag as its mark, a link-like value as something to follow. Anything else is the value
 * as stored, which for most types is already what it means.
 *
 * Shared by everything that shows a label value it is not editing — a table cell, a chip in a field
 * holding several — so that the same stored text reads the same way wherever it turns up.
 */
export function renderLabelValue(value: string, labelType: LabelType | undefined) {
    if (labelType === "date" || labelType === "datetime") {
        return formatLabelDate(value, labelType === "datetime");
    }

    if (labelType === "color") {
        return <ColorSwatch color={value} />;
    }

    if (labelType === "boolean") {
        return renderFlag(value);
    }

    if (labelType === "url") {
        return <a href={safeUrlHref(value)}>{value}</a>;
    }

    const scheme = labelType && LINK_SCHEMES[labelType];
    return scheme !== undefined
        ? <a href={applyLinkScheme(value, scheme)}>{value}</a>
        : value;
}

/** The schemes that make a value of a link-like type clickable; a url is linked by {@link safeUrlHref}. */
const LINK_SCHEMES: Partial<Record<LabelType, string>> = { email: "mailto:", phone: "tel:" };

/** Gives an email/phone value its clickable scheme unless it (an older value, stored as a url) already carries it. */
export function applyLinkScheme(value: unknown, scheme: string): string {
    if (typeof value !== "string" || !value) return "";
    return value.startsWith(scheme) ? value : `${scheme}${value}`;
}

/**
 * Renders a stored date label through the user's formatting locale, all-numeric so that columns stay
 * narrow and every locale shows a four-digit year.
 *
 * Unparseable values are echoed back rather than formatted: label values are free text, so a
 * date-typed field can hold anything a user typed, imported, or left behind by retyping a text
 * label as a date. `Intl.DateTimeFormat` throws a `RangeError` on an invalid date, and since this
 * can run inside a Tabulator formatter, that would take down the whole grid rather than one cell.
 */
export function formatLabelDate(value: unknown, withTime: boolean) {
    if (typeof value !== "string" || !value) return "";
    // Passed as a string so that formatDateNumeric() keeps its date-only ("YYYY-MM-DD") handling,
    // which pins the value to the local calendar day instead of shifting it across timezones.
    if (Number.isNaN(new Date(value).getTime())) return value;
    return formatDateNumeric(value, withTime);
}

/**
 * A flag as the mark a single-valued field shows, so that a field holding several reads the same way
 * as one holding the one. The stored text is kept in the tooltip, a value that is neither of the two
 * being a thing worth being able to see.
 */
function renderFlag(value: string) {
    return <Icon
        className={value === "true" ? "label-flag-set" : "label-flag-unset"}
        icon={value === "true" ? "bx bx-check" : "bx bx-x"}
        title={value}
    />;
}

/**
 * A colour as the square it is read as where the colour cannot be the whole ground: a chip being
 * edited, which also holds the button removing it, a mark no user-picked ground can be trusted to
 * keep visible. A chip only being read holds nothing, and wears the colour itself.
 *
 * The colour is the one thing about the swatch that cannot be told beforehand; its shape and size are
 * its class's. A value naming no colour is dropped by the browser, leaving the outline behind rather
 * than showing it as a colour it is not — and the text behind it is carried in the tooltip, colours
 * being read by eye and their values wanted only now and then.
 */
export function ColorSwatch({ color }: { color: string }) {
    return <span className="label-color-swatch" title={color} style={{ backgroundColor: color }} />;
}

/**
 * A colour as a chip that is nothing but the colour: for wherever a colour is only read — a table
 * cell, a chip among several, an attribute row — and so has no text or button needing a ground of
 * their own. The stored text is kept to the tooltip, and one naming no colour is dropped by the
 * browser, leaving the chip's own empty ring rather than showing a colour it is not.
 */
export function ColorChip({ color }: { color: string }) {
    return <span className="tn-chip label-color-chip" title={color} style={{ backgroundColor: color }} />;
}

/**
 * The values a field holding several shows, read-only: the set as the very chips it is edited as, so
 * that reading and editing show the same thing.
 */
export function LabelValueChips({ values, labelType, className }: {
    values: readonly string[];
    labelType: LabelType | undefined;
    className?: string;
}) {
    return (
        <span className={clsx("label-value-chips", className)}>
            {values.map((value) => (
                labelType === "color" ? (
                    // Read-only, the chip holds nothing — no text, no button — so the colour can be
                    // its whole ground.
                    <ColorChip key={value} color={value} />
                ) : (
                    // A flag's chip takes a wash of the answer it carries, so a row of checks and
                    // crosses reads apart at a glance, before the marks themselves are.
                    <span
                        key={value}
                        className={clsx("tn-chip", labelType === "boolean" &&
                            (value === "true" ? "label-flag-chip-set" : "label-flag-chip-unset"))}
                    >
                        <span>{renderLabelValue(value, labelType)}</span>
                    </span>
                )
            ))}
        </span>
    );
}

/**
 * The values a multi-valued label holds, as a set. Stored as an array where one is passed around as
 * such, but a single-valued definition retyped as a multi one leaves a bare string behind, and an
 * unset field leaves nothing at all — so anything else is read as the set it stands for.
 */
export function asLabelValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return typeof value === "string" && value ? [ value ] : [];
}
