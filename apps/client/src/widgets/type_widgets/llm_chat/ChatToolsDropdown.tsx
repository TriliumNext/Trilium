import "./ChatToolsDropdown.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import appContext from "../../../components/app_context.js";
import { t } from "../../../services/i18n.js";
import { readSearchProviders, resolveWebSearch, type SearchProviderOption, type WebSearchState } from "../../../services/llm_providers.js";
import ActionButton from "../../react/ActionButton.js";
import Dropdown from "../../react/Dropdown.js";
import { FormDropdownDivider, FormListHeader, FormListItem, FormListToggleableItem } from "../../react/FormList.js";
import { useTriliumOption } from "../../react/hooks.js";
import Icon from "../../react/Icon.js";
import MaskedIcon from "../../react/MaskedIcon.js";
import { providerIconUrl } from "../options/llm/provider_icons.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

/**
 * The Tools menu of the chat input bar: what the model can reach this turn, one section per group
 * of tools. Its rows leave the menu open, so several can be changed in one visit. Its toggle
 * shares the compact combo box styling of the model picker beside it.
 */
export default function ChatToolsDropdown({ enableNoteTools, onNoteToolsChange, modelProvider, webSearch, searchProviders, onWebSearchChoose, disabled }: {
    enableNoteTools: boolean;
    /** The provider type of the current model, whose mark stands for its built-in search. */
    modelProvider: string | undefined;
    onNoteToolsChange: (newValue: boolean) => void;
    webSearch: WebSearchState;
    searchProviders: SearchProviderOption[];
    /** Called with `"disabled"`, `"builtin"` or the config id of a search provider. */
    onWebSearchChoose: (choice: string) => void;
    disabled?: boolean;
}) {
    const anyActive = enableNoteTools || webSearch.enableWebSearch;
    const searchProviderUnavailable = webSearch.searchProviderUnavailableKey && t(webSearch.searchProviderUnavailableKey);

    return (
        <Dropdown
            text={<Icon icon="bx bx-shield-quarter" className={clsx("llm-chat-tools-icon", anyActive && "llm-chat-tools-on")} />}
            buttonClassName="llm-chat-model-select llm-chat-tools-button"
            className="llm-chat-tools"
            title={t("llm_chat.tools")}
            titlePosition="top"
            placement="top-start"
            disabled={disabled}
        >
            <FormListToggleableItem
                icon="bx bx-note"
                title={t("llm_chat.note_tools")}
                description={t("llm_chat.note_tools_description")}
                currentValue={enableNoteTools}
                onChange={onNoteToolsChange}
            />

            <FormDropdownDivider />
            <FormListHeader
                text={t("llm_chat.web_search")}
                action={
                    <ActionButton
                        icon="bx bx-cog"
                        text={t("llm_chat.manage_search_providers")}
                        onClick={() => appContext.triggerCommand("showOptions", { section: "_optionsLlm" })}
                    />
                }
            />
            <WebSearchChoice choice="disabled" webSearch={webSearch} onChoose={onWebSearchChoose}>
                <Icon icon="bx bx-block" className="llm-chat-tools-choice-icon" />
                {t("llm_chat.web_search_disabled")}
            </WebSearchChoice>
            <WebSearchChoice
                choice="builtin"
                webSearch={webSearch}
                onChoose={onWebSearchChoose}
                unavailableReason={webSearch.builtInUnavailableKey && t(webSearch.builtInUnavailableKey)}
            >
                {modelProvider
                    ? <MaskedIcon url={providerIconUrl(modelProvider)} className="llm-chat-tools-choice-icon" />
                    : <Icon icon="bx bx-globe" className="llm-chat-tools-choice-icon" />}
                {t("llm_chat.web_search_builtin")}
            </WebSearchChoice>
            {searchProviders.map(provider => (
                <WebSearchChoice
                    key={provider.id}
                    choice={provider.id}
                    webSearch={webSearch}
                    onChoose={onWebSearchChoose}
                    unavailableReason={searchProviderUnavailable}
                >
                    <MaskedIcon url={providerIconUrl(provider.provider)} className="llm-chat-tools-choice-icon" />
                    {provider.name}
                </WebSearchChoice>
            ))}
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

/**
 * One choice of the web search section. A choice the current model can't use stays listed,
 * disabled, with the reason on an info icon beside it; the marked one is shown as such either way.
 */
function WebSearchChoice({ choice, webSearch, onChoose, unavailableReason, children }: {
    choice: string;
    webSearch: WebSearchState;
    onChoose: (choice: string) => void;
    unavailableReason?: string;
    children: ComponentChildren;
}) {
    return (
        <FormListItem
            checkable
            checked={webSearch.choice === choice}
            disabled={!!unavailableReason}
            disabledTooltip={unavailableReason}
            closeOnSelect={false}
            onClick={() => onChoose(choice)}
        >
            {children}
        </FormListItem>
    );
}
