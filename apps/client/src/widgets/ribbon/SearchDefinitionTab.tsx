import "./SearchDefinitionTab.css";

import { SaveSearchNoteResponse } from "@triliumnext/commons";
import { useContext, useEffect, useState } from "preact/hooks";
import { Fragment } from "preact/jsx-runtime";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import bulk_action, { ACTION_GROUPS } from "../../services/bulk_action";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { getErrorMessage } from "../../services/utils";
import ws from "../../services/ws";
import RenameNoteBulkAction from "../bulk_actions/note/rename_note";
import Button, { SplitButton } from "../react/Button";
import Dropdown from "../react/Dropdown";
import { FormListHeader, FormListItem } from "../react/FormList";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { ParentComponent } from "../react/react_utils";
import ResponsiveContainer from "../react/ResponsiveContainer";
import { TabContext } from "./ribbon-interface";
import { SEARCH_OPTIONS, SearchOption } from "./SearchDefinitionOptions";

export default function SearchDefinitionTab({ note, ntxId, hidden }: Pick<TabContext, "note" | "ntxId" | "hidden">) {
    const parentComponent = useContext(ParentComponent);
    const [ searchOptions, setSearchOptions ] = useState<{ availableOptions: SearchOption[], activeOptions: SearchOption[] }>();
    const [ error, setError ] = useState<{ message: string }>();

    function refreshOptions() {
        if (!note) return;

        const availableOptions: SearchOption[] = [];
        const activeOptions: SearchOption[] = [];

        for (const searchOption of SEARCH_OPTIONS) {
            const attr = note.getAttribute(searchOption.attributeType, searchOption.attributeName);
            if (attr) {
                activeOptions.push(searchOption);
            } else {
                availableOptions.push(searchOption);
            }
        }

        setSearchOptions({ availableOptions, activeOptions });
    }

    async function refreshResults() {
        const noteId = note?.noteId;
        if (!noteId) {
            return;
        }

        try {
            const result = await froca.loadSearchNote(noteId);
            if (result?.error) {
                setError({ message: result?.error});
            } else {
                setError(undefined);
            }
        } catch (e: unknown) {
            toast.showError(getErrorMessage(e));
        }

        parentComponent?.triggerEvent("searchRefreshed", { ntxId });
    }

    // Refresh the list of available and active options.
    useEffect(refreshOptions, [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().find((attrRow) => attributes.isAffecting(attrRow, note))) {
            refreshOptions();
        }
    });

    return (
        <div className="search-definition-widget">
            <div className="search-settings">
                {note && !hidden && (
                    <table className="search-setting-table">
                        <tbody>
                            <tr>
                                <td className="title-column">{t("search_definition.add_search_option")}</td>
                                <td colSpan={2} className="add-search-option">
                                    <ResponsiveContainer
                                        desktop={searchOptions?.availableOptions.map(({ icon, label, tooltip, attributeName, attributeType, defaultValue }) => (
                                            <Button
                                                key={`${attributeType}-${attributeName}`}
                                                size="small" icon={icon} text={label} title={tooltip}
                                                onClick={() => attributes.setAttribute(note, attributeType, attributeName, defaultValue ?? "")}
                                            />
                                        ))}
                                        mobile={
                                            <Dropdown
                                                buttonClassName="action-add-toggle btn btn-sm"
                                                text={<><Icon icon="bx bx-plus" />{" "}{t("search_definition.option")}</>}
                                                dropdownContainerClassName="mobile-bottom-menu" mobileBackdrop
                                                noSelectButtonStyle
                                            >
                                                {searchOptions?.availableOptions.map(({ icon, label, tooltip, attributeName, attributeType, defaultValue }) => (
                                                    <FormListItem
                                                        key={`${attributeType}-${attributeName}`}
                                                        icon={icon}
                                                        description={tooltip}
                                                        onClick={() => attributes.setAttribute(note, attributeType, attributeName, defaultValue ?? "")}
                                                    >{label}</FormListItem>
                                                ))}
                                            </Dropdown>
                                        }
                                    />

                                    <AddBulkActionButton note={note} />
                                </td>
                            </tr>
                        </tbody>
                        <tbody className="search-options">
                            {searchOptions?.activeOptions.map(({ attributeType, attributeName, component, additionalAttributesToDelete, defaultValue }) => {
                                const Component = component;
                                return <Component
                                    attributeName={attributeName}
                                    attributeType={attributeType}
                                    note={note}
                                    refreshResults={refreshResults}
                                    error={error}
                                    additionalAttributesToDelete={additionalAttributesToDelete}
                                    defaultValue={defaultValue}
                                />;
                            })}
                        </tbody>
                        <BulkActionsList note={note} />
                        <SearchButtonBar note={note} refreshResults={refreshResults} />
                    </table>
                )}
            </div>
        </div>
    );
}

function SearchButtonBar({ note, refreshResults }: {
    note: FNote;
    refreshResults(): void;
}) {
    async function searchAndExecuteActions() {
        await server.post(`search-and-execute-note/${note.noteId}`);
        refreshResults();
        toast.showMessage(t("search_definition.actions_executed"), 3000);
    }

    async function saveSearchNote() {
        const { notePath } = await server.post<SaveSearchNoteResponse>("special-notes/save-search-note", { searchNoteId: note.noteId });
        if (!notePath) return;

        await ws.waitForMaxKnownEntityChangeId();
        await appContext.tabManager.getActiveContext()?.setNote(notePath);

        // Note the {{- notePathTitle}} in json file is not typo, it's unescaping
        // See https://www.i18next.com/translation-function/interpolation#unescape
        toast.showMessage(t("search_definition.search_note_saved", { notePathTitle: await tree.getNotePathTitle(notePath) }));
    }

    return (
        <tbody className="search-actions">
            <tr>
                <td colSpan={3}>
                    <ResponsiveContainer
                        desktop={
                            <div className="search-actions-container">
                                <Button icon="bx bx-search" text={t("search_definition.search_button")} keyboardShortcut="Enter" onClick={refreshResults} />
                                <Button icon="bx bxs-zap" text={t("search_definition.search_execute")} onClick={searchAndExecuteActions} />
                                {note.isHiddenCompletely() && <Button icon="bx bx-save" text={t("search_definition.save_to_note")} onClick={saveSearchNote} />}
                            </div>
                        }
                        mobile={
                            <SplitButton
                                text={t("search_definition.search_button")} icon="bx bx-search"
                                onClick={refreshResults}
                            >
                                <FormListItem icon="bx bxs-zap" onClick={searchAndExecuteActions}>{t("search_definition.search_execute")}</FormListItem>
                                {note.isHiddenCompletely() && <FormListItem icon="bx bx-save" onClick={saveSearchNote}>{t("search_definition.save_to_note")}</FormListItem>}
                            </SplitButton>
                        }
                    />
                </td>
            </tr>
        </tbody>
    );
}

function BulkActionsList({ note }: { note: FNote }) {
    const [ bulkActions, setBulkActions ] = useState<RenameNoteBulkAction[]>();

    function refreshBulkActions() {
        if (note) {
            setBulkActions(bulk_action.parseActions(note));
        }
    }

    // React to changes.
    useEffect(refreshBulkActions, [ note ]);
    useTriliumEvent("entitiesReloaded", ({loadResults}) => {
        if (loadResults.getAttributeRows().find(attr => attr.type === "label" && attr.name === "action" && attributes.isAffecting(attr, note))) {
            refreshBulkActions();
        }
    });

    return (
        <tbody className="action-options">
            {bulkActions?.map(bulkAction => (
                bulkAction.doRender()
            ))}
        </tbody>
    );
}

function AddBulkActionButton({ note }: { note: FNote }) {
    return (
        <Dropdown
            buttonClassName="action-add-toggle btn btn-sm"
            text={<><Icon icon="bx bxs-zap" />{" "}{t("search_definition.action")}</>}
            noSelectButtonStyle
            dropdownContainerClassName="mobile-bottom-menu" mobileBackdrop
        >
            {ACTION_GROUPS.map(({ actions, title }, index) => (
                <Fragment key={index}>
                    <FormListHeader text={title} />

                    <div>
                        {actions.map(({ actionName, actionTitle }) => (
                            <FormListItem key={actionName} onClick={() => bulk_action.addAction(note.noteId, actionName)}>{actionTitle}</FormListItem>
                        ))}
                    </div>
                </Fragment>
            ))}
        </Dropdown>
    );
}
