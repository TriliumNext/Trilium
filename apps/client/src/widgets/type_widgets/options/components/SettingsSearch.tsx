import "./SettingsSearch.css";

import { useRef } from "preact/hooks";

import { t } from "../../../../services/i18n";
import ActionButton from "../../../react/ActionButton";
import FormTextBox from "../../../react/FormTextBox";

interface SettingsSearchProps {
    query: string;
    onChange(query: string): void;
    /** Called when the field takes focus, which is what opens the search results. */
    onFocus(): void;
}

/**
 * The field at the top of the settings sidebar, which looks through every page at once rather than
 * through the one on show. Focusing it is enough to open the results, so that what is typed lands
 * somewhere it can be read straight away.
 */
export default function SettingsSearch({ query, onChange, onFocus }: SettingsSearchProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <div className="settings-search">
            <span className="settings-search-icon bx bx-search" aria-hidden="true" />

            <FormTextBox
                inputRef={inputRef}
                className="settings-search-input"
                placeholder={t("options.search_placeholder")}
                aria-label={t("options.search_placeholder")}
                currentValue={query}
                onChange={onChange}
                onFocus={onFocus}
            />

            {query && (
                <ActionButton
                    className="settings-search-clear"
                    icon="bx bx-x"
                    text={t("options.search_clear")}
                    onClick={() => {
                        onChange("");
                        inputRef.current?.focus();
                    }}
                />
            )}
        </div>
    );
}
