import "./BulkAction.css";

import { ComponentChildren } from "preact";
import { memo } from "preact/compat";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import { AttributeNameSuggestion, fetchAttributeNames } from "../attribute_widgets/attribute_detail";
import { useLabelValueSuggestions } from "../attribute_widgets/label_value_input";
import { CardSection } from "../react/Card";
import FormAutocomplete from "../react/FormAutocomplete";
import { useSpacedUpdate } from "../react/hooks";
import HelpRemoveButtons from "../react/HelpRemoveButtons";
import Icon from "../react/Icon";
import AbstractBulkAction, { ActionDefinition } from "./abstract_bulk_action";

interface BulkActionProps {
    children?: ComponentChildren;
    bulkAction: AbstractBulkAction;
}

const BulkAction = memo(({ children, bulkAction }: BulkActionProps) => {
    const { actionIcon, actionTitle, actionDescription } = bulkAction.constructor as typeof AbstractBulkAction;

    return (
        <CardSection className="bulk-action">
            <span className="bulk-action-title">
                {actionIcon && <Icon icon={actionIcon} className="bulk-action-icon" />}{actionTitle}
            </span>
            <div className="bulk-action-fields">
                {children ?? <span className="bulk-action-description">{actionDescription}</span>}
            </div>
            <HelpRemoveButtons
                className="bulk-action-actions"
                removeText={t("bulk_actions.remove_action")}
                onRemove={() => bulkAction?.deleteAction()}
            />
        </CardSection>
    );
});

export default BulkAction;

/**
 * Saves `data` to `bulkAction` a second after it changes. The values a row opens with are already
 * stored, so the first render saves nothing.
 */
export function useSaveAction(bulkAction: AbstractBulkAction, data: Partial<ActionDefinition>) {
    const spacedUpdate = useSpacedUpdate(() => bulkAction.saveAction(data));
    const isFirstRender = useRef(true);
    const serialized = JSON.stringify(data);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        spacedUpdate.scheduleUpdate();
    }, [ serialized ]);
}

/** Separates a row's source field from its target field, in place of a word such as "to". */
export function BulkActionArrow() {
    return <Icon icon="bx bx-right-arrow-alt" className="bulk-action-arrow" />;
}

/** A row's label or relation name field, completing against the names already in use. */
export function BulkActionAttributeName({ type, currentValue, onChange, placeholder, title }: {
    type: "label" | "relation";
    currentValue: string | undefined;
    onChange(newValue: string): void;
    placeholder: string;
    title: string;
}) {
    const suggestNames = useCallback((query: string) => fetchAttributeNames(type, query), [ type ]);
    const renderSuggestion = useCallback(
        (name: string, query: string) => <AttributeNameSuggestion type={type} name={name} query={query} />, [ type ]);

    return (
        <FormAutocomplete
            className="bulk-action-name" required
            pattern="[\p{L}\p{N}_:]+"
            placeholder={placeholder}
            title={title}
            currentValue={currentValue ?? ""}
            onChange={onChange}
            source={suggestNames}
            renderItem={renderSuggestion}
            openOnFocus
        />
    );
}

/** A row's label value field, completing against the values the label `name` already has. */
export function BulkActionLabelValue({ name, currentValue, onChange, placeholder }: {
    name: string;
    currentValue: string;
    onChange(newValue: string): void;
    placeholder: string;
}) {
    const suggestValues = useLabelValueSuggestions(name);

    return (
        <FormAutocomplete
            placeholder={placeholder}
            currentValue={currentValue}
            onChange={onChange}
            source={suggestValues}
            openOnFocus
        />
    );
}
