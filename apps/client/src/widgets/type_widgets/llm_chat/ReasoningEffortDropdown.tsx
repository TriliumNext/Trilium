import "./ReasoningEffortDropdown.css";

import type { LlmModelInfo, LlmReasoningEffort } from "@triliumnext/commons";

import { t } from "../../../services/i18n.js";
import Dropdown from "../../react/Dropdown.js";
import { FormListItem } from "../../react/FormList.js";
import Icon from "../../react/Icon.js";

/**
 * The reasoning effort picker of the chat input bar, for a model that lists
 * `reasoningEfforts`; such a model has no extended thinking switch. It stands
 * beside the model picker and shares its combobox styling.
 */
export default function ReasoningEffortDropdown({ model, value, onChange, disabled, inSidebar }: {
    model: LlmModelInfo;
    /** The chat's chosen level; undefined means the model's default. */
    value: LlmReasoningEffort | undefined;
    onChange: (effort: LlmReasoningEffort) => void;
    disabled?: boolean;
    inSidebar?: boolean;
}) {
    const effective = effectiveReasoningEffort(model, value);
    const label = t(`llm_chat.reasoning_effort_levels.${effective}`);

    return (
        <Dropdown
            text={<>
                <Icon icon="bx bx-brain" className="llm-chat-reasoning-effort-icon" />
                <span className="llm-chat-model-select-name">{label}</span>
            </>}
            title={t("llm_chat.reasoning_effort_title", { level: label })}
            titlePosition="top"
            buttonClassName="llm-chat-model-select"
            className="llm-chat-reasoning-effort"
            disabled={disabled}
            // A few items, so the menu never scrolls and keeps the working backdrop blur.
            noDropdownListStyle
            // Same reason as the model selector: the sidebar clips an unportaled menu.
            portalToBody={inSidebar}
            dropdownOptions={inSidebar ? { popperConfig: { strategy: "fixed" } } : undefined}
        >
            {(model.reasoningEfforts ?? []).map(level => (
                <FormListItem key={level} checked={level === effective} onClick={() => onChange(level)}>
                    {t(`llm_chat.reasoning_effort_levels.${level}`)}
                </FormListItem>
            ))}
        </Dropdown>
    );
}

/** The level a turn runs at: the chat's choice where the model has it, else the model's default, else its strongest. */
export function effectiveReasoningEffort(model: LlmModelInfo, value: LlmReasoningEffort | undefined): LlmReasoningEffort {
    const levels = model.reasoningEfforts ?? [];
    if (value && levels.includes(value)) {
        return value;
    }
    return model.defaultReasoningEffort ?? levels[levels.length - 1] ?? "high";
}
