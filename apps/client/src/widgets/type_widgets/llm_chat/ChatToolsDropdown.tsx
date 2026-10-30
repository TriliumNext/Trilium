import "./ChatToolsDropdown.css";

import { LLM_PERMISSION_MODES, type LlmPermissionMode } from "@triliumnext/commons";
import clsx from "clsx";
import { useMemo } from "preact/hooks";

import appContext from "../../../components/app_context.js";
import { t } from "../../../services/i18n.js";
import { readSearchProviders, resolveWebSearch, type SearchProviderOption, type WebSearchState } from "../../../services/llm_providers.js";
import Dropdown from "../../react/Dropdown.js";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem, FormListToggleableItem } from "../../react/FormList.js";
import { useTriliumOption } from "../../react/hooks.js";
import Icon from "../../react/Icon.js";
import { providerIcon } from "../options/llm/provider_icons.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

/**
 * The Tools menu of the chat input bar: what the model can reach this turn. Note access is a row of
 * its own; web search is a submenu of its sources, whose row shows the chosen one; which calls wait for the user is a submenu of the
 * permission modes; the tools allowed for the chat, once there are any, are a submenu that makes the chat ask about one again. Its rows leave
 * the menu open, so several can be changed in one visit. Its toggle shares the compact combo box
 * styling of the model picker beside it.
 */
export default function ChatToolsDropdown({ enableNoteTools, onNoteToolsChange, modelProvider, webSearch, searchProviders, onWebSearchChoose, allowedTools, onRevokeAllowedTool, permissionMode, onPermissionModeChange, disabled }: {
    enableNoteTools: boolean;
    /** The provider type of the current model, whose mark stands for its built-in search. */
    modelProvider: string | undefined;
    onNoteToolsChange: (newValue: boolean) => void;
    webSearch: WebSearchState;
    searchProviders: SearchProviderOption[];
    /** Called with `"disabled"`, `"builtin"` or the config id of a search provider. */
    onWebSearchChoose: (choice: string) => void;
    /** The tools whose calls run without asking in this chat. */
    allowedTools: string[];
    onRevokeAllowedTool: (toolName: string) => void;
    permissionMode: LlmPermissionMode;
    onPermissionModeChange: (mode: LlmPermissionMode) => void;
    disabled?: boolean;
}) {
    const anyActive = enableNoteTools || webSearch.enableWebSearch;
    const sources = getWebSearchSources(modelProvider, webSearch, searchProviders);
    const chosen = sources.find((source) => source.choice === webSearch.choice) ?? sources[0];

    return (
        <Dropdown
            text={<Icon icon="bx bx-shield-quarter" className={clsx("llm-chat-tools-icon", anyActive && "llm-chat-tools-on")} />}
            buttonClassName="llm-chat-model-select llm-chat-tools-button"
            className="llm-chat-tools"
            title={t("llm_chat.tools")}
            titlePosition="top"
            placement="top-start"
            disabled={disabled}
            mobileBottomSheet
        >
            <FormListToggleableItem
                icon="bx bx-note"
                title={t("llm_chat.note_tools")}
                description={t("llm_chat.note_tools_description")}
                currentValue={enableNoteTools}
                onChange={onNoteToolsChange}
            />

            <FormDropdownSubmenu
                icon={chosen.icon}
                title={t("llm_chat.web_search")}
                description={chosen.label}
            >
                {sources.map((source) => (
                    <FormListItem
                        key={source.choice}
                        checkable
                        checked={source === chosen}
                        disabled={!!source.unavailableReason}
                        disabledTooltip={source.unavailableReason}
                        closeOnSelect={false}
                        onClick={() => onWebSearchChoose(source.choice)}
                    >
                        <Icon icon={source.icon} className="llm-chat-tools-choice-icon" />
                        {source.label}
                    </FormListItem>
                ))}
                <FormDropdownDivider />
                <FormListItem
                    icon="bx bx-cog"
                    onClick={() => appContext.triggerCommand("showOptions", { section: "_optionsLlm" })}
                >
                    {t("llm_chat.manage_search_providers")}
                </FormListItem>
            </FormDropdownSubmenu>

            <FormDropdownSubmenu
                icon="bx bxs-hand"
                title={t("llm_chat.permissions")}
                description={t(`llm_chat.permission_mode_${permissionMode}`)}
            >
                {LLM_PERMISSION_MODES.map((mode) => (
                    <FormListItem
                        key={mode}
                        checkable
                        checked={mode === permissionMode}
                        description={t(`llm_chat.permission_mode_${mode}_description`)}
                        closeOnSelect={false}
                        onClick={() => onPermissionModeChange(mode)}
                    >
                        {t(`llm_chat.permission_mode_${mode}`)}
                    </FormListItem>
                ))}
            </FormDropdownSubmenu>

            {allowedTools.length > 0 && (
                <FormDropdownSubmenu
                    icon="bx bx-check-double"
                    title={t("llm_chat.allowed_tools")}
                    description={t("llm_chat.allowed_tools_count", { count: allowedTools.length })}
                >
                    {allowedTools.map((toolName) => (
                        <FormListItem
                            key={toolName}
                            checkable
                            checked
                            closeOnSelect={false}
                            onClick={() => onRevokeAllowedTool(toolName)}
                        >
                            {t(`llm.tools.${toolName}`, { defaultValue: toolName })}
                        </FormListItem>
                    ))}
                </FormDropdownSubmenu>
            )}
        </Dropdown>
    );
}

/**
 * The chat's web search for a model of `modelProvider`, resolved as `useLlmChat` resolves it for
 * sending so the menu marks what the turn will use, with the search providers to offer and the
 * handler for a choice. `onChange` runs after every choice.
 */
export function useChatWebSearch(
    chat: Pick<UseLlmChatReturn, "enableWebSearch" | "enableNoteTools" | "setEnableWebSearch">,
    modelProvider: string | undefined,
    onChange?: () => void
) {
    const [ llmProviders ] = useTriliumOption("llmProviders");
    const [ searchProviderId, setSearchProviderId ] = useTriliumOption("llmWebSearchProvider");
    // Read through `options`; `llmProviders` is the dependency so the list follows the settings.
    const searchProviders = useMemo(readSearchProviders, [ llmProviders ]);
    const webSearch = resolveWebSearch({
        modelProvider,
        enableWebSearch: chat.enableWebSearch,
        enableNoteTools: chat.enableNoteTools,
        searchProviderId,
        searchProviders
    });

    /** Turns web search off for this chat, or on with the chosen source, which every chat shares. */
    const chooseWebSearch = (choice: string) => {
        chat.setEnableWebSearch(choice !== "disabled");
        if (choice !== "disabled") {
            void setSearchProviderId(choice === "builtin" ? "" : choice);
        }
        onChange?.();
    };

    return { webSearch, searchProviders, chooseWebSearch };
}

/** A source web search can be turned to: off, the model's built-in search, or a search provider. */
interface WebSearchSource {
    /** `"disabled"`, `"builtin"` or the config id of a search provider. */
    choice: string;
    label: string;
    /** The icon class, such as `bx bx-block` or a provider's mark. */
    icon: string;
    /** Why the current model can't use the source. A source it can't use stays listed, disabled. */
    unavailableReason?: string;
}

function getWebSearchSources(
    modelProvider: string | undefined,
    webSearch: WebSearchState,
    searchProviders: SearchProviderOption[]
): WebSearchSource[] {
    const searchProviderUnavailable = webSearch.searchProviderUnavailableKey
        && t(webSearch.searchProviderUnavailableKey);
    return [
        { choice: "disabled", label: t("llm_chat.web_search_disabled"), icon: "bx bx-block" },
        {
            choice: "builtin",
            label: t("llm_chat.web_search_builtin"),
            // The model's own mark stands for its built-in search.
            icon: modelProvider ? providerIcon(modelProvider) : "bx bx-globe",
            unavailableReason: webSearch.builtInUnavailableKey && t(webSearch.builtInUnavailableKey)
        },
        ...searchProviders.map((provider) => ({
            choice: provider.id,
            label: provider.name,
            icon: providerIcon(provider.provider),
            unavailableReason: searchProviderUnavailable
        }))
    ];
}
