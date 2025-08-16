import { ActionKeyboardShortcut, KeyboardShortcut } from "@triliumnext/commons";
import { t } from "../../../services/i18n";
import { reloadFrontendApp } from "../../../services/utils";
import Button from "../../react/Button";
import FormGroup from "../../react/FormGroup";
import FormText from "../../react/FormText";
import FormTextBox from "../../react/FormTextBox";
import RawHtml from "../../react/RawHtml";
import OptionsSection from "./components/OptionsSection";
import { useCallback, useEffect, useState } from "preact/hooks";
import server from "../../../services/server";
import options from "../../../services/options";
import dialog from "../../../services/dialog";

export default function ShortcutSettings() {
    const [ keyboardShortcuts, setKeyboardShortcuts ] = useState<KeyboardShortcut[]>([]);
    const [ filter, setFilter ] = useState<string>();
    
    useEffect(() => {
        server.get<KeyboardShortcut[]>("keyboard-actions").then(setKeyboardShortcuts);
    }, [])

    const resetShortcuts = useCallback(async () => {
        if (!(await dialog.confirm(t("shortcuts.confirm_reset")))) {
            return;
        }

        const newKeyboardShortcuts = [];
        for (const keyboardShortcut of keyboardShortcuts) {
            if (!("effectiveShortcuts" in keyboardShortcut)) {
                continue;
            }

        }
    }, [ keyboardShortcuts ]);

    return (
        <OptionsSection
            className="shortcuts-options-section"
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
            noCard
        >
            <FormText>
                {t("shortcuts.multiple_shortcuts")}
                <RawHtml html={t("shortcuts.electron_documentation")} />
            </FormText>

            <FormGroup>
                <FormTextBox
                    name="keyboard-shortcut-filter"
                    placeholder={t("shortcuts.type_text_to_filter")}
                    currentValue={filter} onChange={(value) => setFilter(value.toLowerCase())}
                />
            </FormGroup>

            <div style={{overflow: "auto", flexGrow: 1, flexShrink: 1}}>
                <KeyboardShortcutTable keyboardShortcuts={keyboardShortcuts} filter={filter} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", margin: "15px 15px 0 15px"}}>
                <Button
                    text={t("shortcuts.reload_app")}
                    onClick={reloadFrontendApp}
                />

                <Button
                    text={t("shortcuts.set_all_to_default")}
                    onClick={resetShortcuts}
                />
            </div>
        </OptionsSection>
    )
}

function filterKeyboardAction(action: ActionKeyboardShortcut, filter: string) {
    return action.actionName.toLowerCase().includes(filter) ||
        (action.friendlyName && action.friendlyName.toLowerCase().includes(filter)) ||
        (action.defaultShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
        (action.effectiveShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
        (action.description && action.description.toLowerCase().includes(filter));
}

function KeyboardShortcutTable({ filter, keyboardShortcuts }: { filter?: string, keyboardShortcuts: KeyboardShortcut[] }) {
    return (
        <table class="keyboard-shortcut-table" cellPadding="10">
            <thead>
                <tr class="text-nowrap">
                    <th>{t("shortcuts.action_name")}</th>
                    <th>{t("shortcuts.shortcuts")}</th>
                    <th>{t("shortcuts.default_shortcuts")}</th>
                    <th>{t("shortcuts.description")}</th>
                </tr>
            </thead>
            <tbody>
                {keyboardShortcuts.map(action => (
                    <tr>
                        {"separator" in action ? ( !filter &&
                            <td class="separator" colspan={4} style={{
                                backgroundColor: "var(--accented-background-color)",
                                fontWeight: "bold"
                            }}>
                                {action.separator}
                            </td>
                        ) : ( (!filter || filterKeyboardAction(action, filter)) && 
                            <>
                                <td>{action.friendlyName}</td>
                                <td>
                                    <ShortcutEditor keyboardShortcut={action} />
                                </td>
                                <td>{action.defaultShortcuts?.join(", ")}</td>
                                <td>{action.description}</td>
                            </>
                        )}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function ShortcutEditor({ keyboardShortcut: action }: { keyboardShortcut: ActionKeyboardShortcut }) {
    const originalShortcut = (action.effectiveShortcuts ?? []).join(", ");

    return (
        <FormTextBox
            currentValue={originalShortcut} onChange={(newShortcut) => {
                const { actionName } = action;
                const optionName = `keyboardShortcuts${actionName.substr(0, 1).toUpperCase()}${actionName.substr(1)}`;
                const newShortcuts = newShortcut
                    .replace("+,", "+Comma")
                    .split(",")
                    .map((shortcut) => shortcut.replace("+Comma", "+,"))
                    .filter((shortcut) => !!shortcut);
                options.save(optionName, JSON.stringify(newShortcuts));
            }}
        />
    )
}