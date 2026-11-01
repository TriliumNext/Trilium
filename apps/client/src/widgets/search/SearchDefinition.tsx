import "./SearchDefinition.css";

import { SaveSearchNoteResponse } from "@triliumnext/commons";
import { Fragment } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import type { MenuItem } from "../../menus/context_menu";
import attributes from "../../services/attributes";
import bulk_action, { ACTION_GROUPS } from "../../services/bulk_action";
import { t } from "../../services/i18n";
import search from "../../services/search";
import server from "../../services/server";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { escapeHtml } from "../../services/utils";
import ws from "../../services/ws";
import RenameNoteBulkAction from "../bulk_actions/note/rename_note";
import { SplitButton } from "../react/Button";
import { Card, CardSection } from "../react/Card";
import Dropdown from "../react/Dropdown";
import { FormListItem } from "../react/FormList";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { ParentComponent } from "../react/react_utils";
import { SEARCH_OPTIONS, SearchOption } from "./SearchDefinitionOptions";

export default function SearchDefinition({ note, ntxId }: {
    note: FNote | null | undefined;
    ntxId: string | null | undefined;
}) {
    const parentComponent = useContext(ParentComponent);
    const [ searchOptions, setSearchOptions ] = useState<{ availableOptions: SearchOption[], activeOptions: SearchOption[] }>();
    const [ error, setError ] = useState<{ message: string }>();
    const flushRef = useRef<() => Promise<void>>(null);
    const bulkActions = useBulkActions(note);

    // The server reads the search options from the note's attributes, so a value still waiting
    // in a `SpacedUpdate` is saved first.
    async function savePendingOptions() {
        await flushRef.current?.();
    }

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

        await savePendingOptions();
        const result = await search.runSearchNote(parentComponent, noteId, ntxId);
        if (result) {
            setError(result.error ? { message: result.error } : undefined);
        }
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
            {note && (
                <Card className="search-definition-card">
                    {searchOptions?.activeOptions.map(({ attributeType, attributeName, component, additionalAttributesToDelete, defaultValue }) => {
                        const Component = component;
                        return <Component
                            attributeName={attributeName}
                            attributeType={attributeType}
                            note={note}
                            refreshResults={refreshResults}
                            flushRef={flushRef}
                            error={error}
                            additionalAttributesToDelete={additionalAttributesToDelete}
                            defaultValue={defaultValue}
                        />;
                    })}

                    {bulkActions.map((bulkAction) => (
                        <Fragment key={bulkAction.attribute.attributeId}>{bulkAction.doRender()}</Fragment>
                    ))}

                    <CardSection className="search-definition-actions">
                        <AddSearchOptionButton note={note} options={searchOptions?.availableOptions ?? []} />
                        <SearchButtonBar
                            note={note}
                            refreshResults={refreshResults}
                            savePendingOptions={savePendingOptions}
                        />
                    </CardSection>
                </Card>
            )}
        </div>
    );
}

function SearchButtonBar({ note, refreshResults, savePendingOptions }: {
    note: FNote;
    refreshResults(): void;
    savePendingOptions(): Promise<void>;
}) {
    async function searchAndExecuteActions() {
        await savePendingOptions();
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
        <SplitButton
            text={t("search_definition.search_button")} icon="bx bx-search"
            size="micro"
            keyboardShortcut="Enter"
            onClick={refreshResults}
        >
            <FormListItem icon="bx bxs-zap" onClick={searchAndExecuteActions}>{t("search_definition.search_execute")}</FormListItem>
            {note.isHiddenCompletely() && <FormListItem icon="bx bx-save" onClick={saveSearchNote}>{t("search_definition.save_to_note")}</FormListItem>}
        </SplitButton>
    );
}

function useBulkActions(note: FNote | null | undefined) {
    const [ bulkActions, setBulkActions ] = useState<RenameNoteBulkAction[]>([]);

    function refreshBulkActions() {
        setBulkActions(note ? bulk_action.parseActions(note) : []);
    }

    // React to changes.
    useEffect(refreshBulkActions, [ note ]);
    useTriliumEvent("entitiesReloaded", ({loadResults}) => {
        if (note && loadResults.getAttributeRows().find(attr => attr.type === "label" && attr.name === "action" && attributes.isAffecting(attr, note))) {
            refreshBulkActions();
        }
    });

    return bulkActions;
}

/** A menu of the search options the note does not use yet, and of the bulk actions it can add. */
function AddSearchOptionButton({ note, options }: { note: FNote; options: SearchOption[] }) {
    const items: MenuItem<unknown>[] = options.map(({ icon, label, tooltip, attributeName, attributeType, defaultValue }) => ({
        title: escapeHtml(label),
        tooltip,
        uiIcon: icon,
        handler: () => attributes.setAttribute(note, attributeType, attributeName, defaultValue ?? "")
    }));

    items.push(
        { kind: "header", title: t("bulk_actions.bulk_actions") },
        ...ACTION_GROUPS.map(({ title, icon, actions }) => ({
            title: escapeHtml(title),
            uiIcon: icon,
            items: actions.map(({ actionName, actionTitle, actionIcon, actionDescription }) => ({
                title: escapeHtml(actionTitle),
                tooltip: actionDescription,
                uiIcon: actionIcon,
                handler: () => bulk_action.addAction(note.noteId, actionName)
            }))
        }))
    );

    return (
        <Dropdown
            className="search-definition-add"
            buttonClassName="btn-secondary btn-micro"
            text={<><Icon icon="bx bx-plus" />{" "}{t("search_definition.add_search_option")}</>}
            noSelectButtonStyle
            mobileBottomSheet
            dropdownContainerClassName="action-add-menu"
            items={items}
        />
    );
}
