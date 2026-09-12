import "./SettingsSearch.css";

import { RefObject } from "preact";

import { t } from "../../../../services/i18n";
import ActionButton from "../../../react/ActionButton";
import FormTextBox from "../../../react/FormTextBox";
import { useSyncedRef } from "../../../react/hooks";

interface SettingsSearchProps {
    query: string;
    onChange(query: string): void;
    /** Called when the field takes focus, which is what opens the settings results. */
    onFocus?(): void;
    /** What the field looks through, where that is something other than the settings. */
    placeholder?: string;
    inputRef?: RefObject<HTMLInputElement>;
}

/**
 * The field at the top of the settings sidebar, which looks through every page at once rather than
 * through the one on show. Focusing it is enough to open the results, so that what is typed lands
 * somewhere it can be read straight away.
 *
 * Also stands over the lists of the dialogs the settings open, so that looking through one of those
 * is the same field in the same place (see the font picker in `appearance.tsx`).
 */
export default function SettingsSearch({ query, onChange, onFocus, placeholder = t("options.search_placeholder"), inputRef: externalInputRef }: SettingsSearchProps) {
    const inputRef = useSyncedRef<HTMLInputElement>(externalInputRef);

    return (
        <div className="settings-search">
            <span className="settings-search-icon bx bx-search" aria-hidden="true" />

            <FormTextBox
                inputRef={inputRef}
                className="settings-search-input"
                placeholder={placeholder}
                aria-label={placeholder}
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
