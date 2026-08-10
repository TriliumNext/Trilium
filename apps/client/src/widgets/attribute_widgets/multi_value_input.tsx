import { type LabelType } from "@triliumnext/commons";

import { t } from "../../services/i18n";
import { renderLabelValue } from "./label_value_display";
import { SelectValuesInput } from "./select_input";
import ValuesInput from "./values_input";

interface MultiValueInputProps {
    /** What kind of value the field holds, which decides how one is entered and how one reads. */
    labelType: LabelType;
    /** The values held, in the order they are shown. */
    values: readonly string[];
    /** Receives the values as they now stand, whenever one is taken or dropped. */
    onCommit(values: string[]): void;
    /** The options a `select` holds, from the definition that declared it. Ignored by other types. */
    options?: readonly string[];
    /**
     * Adds an option to a `select` field's definition, for the entry offered on text naming none of
     * them. Left out, the field picks from the options as they stand.
     */
    onCreateOption?(option: string): void | Promise<void>;
    /** Set onto the box, so that a host's own label points at the field. */
    inputId?: string;
    /** Set onto the box, for a host placing its fields in a tab order of its own. */
    tabIndex?: number;
    disabled?: boolean;
}

/**
 * The field a label holding several values is edited through: the values as chips, and a box after
 * them for the next one.
 *
 * Which box that is depends on the kind of value. A closed set — the options of a `select`, or the
 * two a flag can be — is picked from a list, so nothing typed is ever kept. Everything else is
 * entered directly, through the same box a single value of that type is typed or picked in.
 *
 * Shared by the promoted-attribute grid and the table's own cells, so that the same definition is
 * edited the same way wherever the note is opened.
 */
export default function MultiValueInput({ labelType, values, onCommit, options, onCreateOption, inputId, tabIndex, disabled }: MultiValueInputProps) {
    if (labelType === "select" || labelType === "boolean") {
        return (
            <SelectValuesInput
                options={labelType === "boolean" ? BOOLEAN_OPTIONS : options ?? []}
                values={values}
                placeholder={t("promoted_attributes.select_values_placeholder")}
                // A flag's options are the whole of what a flag can be, so there is nothing to add.
                onCreateOption={labelType === "boolean" ? undefined : onCreateOption}
                renderValue={labelType === "boolean" ? renderBooleanValue : undefined}
                inputId={inputId}
                tabIndex={tabIndex}
                disabled={disabled}
                onCommit={onCommit}
            />
        );
    }

    return (
        <ValuesInput
            labelType={labelType}
            values={values}
            placeholder={t("promoted_attributes.values_placeholder")}
            inputId={inputId}
            tabIndex={tabIndex}
            disabled={disabled}
            onCommit={onCommit}
        />
    );
}

/** The whole of what a flag can be, which is what a field of flags picks its values from. */
export const BOOLEAN_OPTIONS = [ "true", "false" ];

function renderBooleanValue(value: string) {
    return renderLabelValue(value, "boolean");
}
