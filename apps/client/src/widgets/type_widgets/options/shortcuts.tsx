import { ActionKeyboardShortcut, KeyboardShortcut, OptionNames } from "@triliumnext/commons";
import { t } from "../../../services/i18n";
import { arrayEqual, reloadFrontendApp } from "../../../services/utils";
import Button from "../../react/Button";
import FormText from "../../react/FormText";
import FormTextBox from "../../react/FormTextBox";
import RawHtml from "../../react/RawHtml";
import OptionsSection from "./components/OptionsSection";
import { useCallback, useEffect, useState } from "preact/hooks";
import server from "../../../services/server";
import options from "../../../services/options";
import dialog from "../../../services/dialog";
import { useTriliumEvent } from "../../react/hooks";
import "./shortcuts.css";
import NoItems from "../../react/NoItems";

export default function ShortcutSettings() {
    const [ keyboardShortcuts, setKeyboardShortcuts ] = useState<KeyboardShortcut[]>([]);
    const [ filter, setFilter ] = useState<string>();

    useEffect(() => {
        server.get<KeyboardShortcut[]>("keyboard-actions").then(setKeyboardShortcuts);
    }, [])

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const optionNames = loadResults.getOptionNames();
        if (!optionNames || !optionNames.length) {
            return;
        }

        let updatedShortcuts: (KeyboardShortcut[] | null) = null;

        for (const optionName of optionNames) {
            if (!(optionName.startsWith("keyboardShortcuts"))) {
                continue;
            }

            const newValue = options.get(optionName);
            const actionName = getActionNameFromOptionName(optionName);
            const correspondingShortcut = keyboardShortcuts.find(s => "actionName" in s && s.actionName === actionName);
            if (correspondingShortcut && "effectiveShortcuts" in correspondingShortcut) {
                correspondingShortcut.effectiveShortcuts = JSON.parse(newValue);

                if (!updatedShortcuts) {
                    updatedShortcuts = Array.from(keyboardShortcuts);
                }
            }
        }

        if (updatedShortcuts) {
            setKeyboardShortcuts(updatedShortcuts);
        }
    });

    const resetShortcuts = useCallback(async () => {
        if (!(await dialog.confirm(t("shortcuts.confirm_reset")))) {
            return;
        }

        const optionsToSet: Record<string, string> = {};
        for (const keyboardShortcut of keyboardShortcuts) {
            if (!("effectiveShortcuts" in keyboardShortcut) || !keyboardShortcut.effectiveShortcuts) {
                continue;
            }

            const defaultShortcuts = keyboardShortcut.defaultShortcuts ?? [];
            if (!arrayEqual(keyboardShortcut.effectiveShortcuts, defaultShortcuts)) {
                optionsToSet[getOptionName(keyboardShortcut.actionName)] = JSON.stringify(defaultShortcuts);
            }
        }
        options.saveMany(optionsToSet);
    }, [ keyboardShortcuts ]);

    const filterLowerCase = filter?.toLowerCase() ?? "";
    const filteredKeyboardShortcuts = filter ? keyboardShortcuts.filter((action) => filterKeyboardAction(action, filterLowerCase)) : keyboardShortcuts;

    return (
        <OptionsSection
            className="shortcuts-options-section"
            noCard
        >
            <FormText>
                {t("shortcuts.multiple_shortcuts")}{" "}
                <RawHtml html={t("shortcuts.electron_documentation")} />
            </FormText>

            <header>
                <FormTextBox
                    placeholder={t("shortcuts.type_text_to_filter")}
                    currentValue={filter} onChange={(value) => setFilter(value)}
                />
            </header>

            <KeyboardShortcutTable filteredKeyboardActions={filteredKeyboardShortcuts} filter={filter} />

            <footer>
                <Button
                    text={t("shortcuts.reload_app")}
                    onClick={reloadFrontendApp}
                />

                <Button
                    text={t("shortcuts.set_all_to_default")}
                    onClick={resetShortcuts}
                />
            </footer>
        </OptionsSection>
    )
}

function filterKeyboardAction(action: KeyboardShortcut, filter: string) {
    // Hide separators when filtering is active.
    if ("separator" in action) {
        return !filter;
    }

    return action.actionName.toLowerCase().includes(filter) ||
        (action.friendlyName && action.friendlyName.toLowerCase().includes(filter)) ||
        (action.defaultShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
        (action.effectiveShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
        (action.description && action.description.toLowerCase().includes(filter));
}

function KeyboardShortcutTable({ filteredKeyboardActions, filter }: { filteredKeyboardActions: KeyboardShortcut[], filter: string | undefined }) {
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
                {filteredKeyboardActions.length > 0
                 ? filteredKeyboardActions.map(action => (
                    <tr>
                        {"separator" in action ?
                            <td class="separator" colspan={4} style={{
                                backgroundColor: "var(--accented-background-color)",
                                fontWeight: "bold"
                            }}>
                                {action.separator}
                            </td>
                        : (
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
                ))
                : (
                    <tr>
                        <td colspan={4} class="text-center">
                            <NoItems
                                icon="bx bx-filter-alt"
                                text={t("shortcuts.no_results", { filter })}
                            />
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}

function ShortcutEditor({ keyboardShortcut: action }: { keyboardShortcut: ActionKeyboardShortcut }) {
    const originalShortcut = (action.effectiveShortcuts ?? []).join(", ");

    return (
        <FormTextBox
            currentValue={originalShortcut}
            onBlur={(newShortcut) => {
                const { actionName } = action;
                const optionName = getOptionName(actionName);
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

const PREFIX = "keyboardShortcuts";

function getOptionName(actionName: string) {
    return `${PREFIX}${actionName.substr(0, 1).toUpperCase()}${actionName.substr(1)}` as OptionNames;
}

function getActionNameFromOptionName(optionName: string) {
    return optionName.at(PREFIX.length)?.toLowerCase() + optionName.substring(PREFIX.length + 1);
}
