import { useEffect, useState, useCallback } from "preact/hooks";
import { t } from "../../services/i18n";
import Modal from "../react/Modal";
import "./bulk_actions.css";
import { BulkActionAffectedNotes } from "@triliumnext/commons";
import server from "../../services/server";
import FormCheckbox from "../react/FormCheckbox";
import Button from "../react/Button";
import bulk_action from "../../services/bulk_action";
import dialog from "../../services/dialog";
import toast from "../../services/toast";
import AbstractBulkAction from "../bulk_actions/abstract_bulk_action";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { useTriliumEvent } from "../react/hooks";

export default function BulkActionsDialog() {
    const [ selectedOrActiveNoteIds, setSelectedOrActiveNoteIds ] = useState<string[]>();
    const [ bulkActionNote, setBulkActionNote ] = useState<FNote | null>();
    const [ includeDescendants, setIncludeDescendants ] = useState(false);
    const [ affectedNoteCount, setAffectedNoteCount ] = useState(0);
    const [ existingActions, setExistingActions ] = useState<AbstractBulkAction[]>([]);
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("openBulkActionsDialog", async ({ selectedOrActiveNoteIds }) => {
        setSelectedOrActiveNoteIds(selectedOrActiveNoteIds);
        setBulkActionNote(await froca.getNote("_bulkAction"));
        setShown(true);
    });

    useEffect(() => {
        if (!selectedOrActiveNoteIds || !bulkActionNote) return;
        
        server.post<BulkActionAffectedNotes>("bulk-action/affected-notes", {
            noteIds: selectedOrActiveNoteIds,
            includeDescendants
        }).then(({ affectedNoteCount }) => setAffectedNoteCount(affectedNoteCount));
    }, [ selectedOrActiveNoteIds, includeDescendants, bulkActionNote ]);

    const refreshExistingActions = useCallback(() => {
        if (!bulkActionNote) return;
        setExistingActions(bulk_action.parseActions(bulkActionNote));
    }, [bulkActionNote]);
    
    useEffect(() => {
        refreshExistingActions();
    }, [refreshExistingActions]);
    
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().find((row) =>
            row.type === "label" && row.name === "action" && row.noteId === "_bulkAction")) {
                refreshExistingActions();
        }
    });

    return (
        <Modal
            className="bulk-actions-dialog"
            size="xl"
            title={t("bulk_actions.bulk_actions")}
            footer={<>
                <Button text={t("modal.cancel")} onClick={() => setShown(false)} />
                <Button text={t("bulk_actions.execute_bulk_actions")} kind="primary" />
            </>}
            show={shown}
            onSubmit={async () => {
                // Let actions surface a confirmation prompt (e.g. lossy conversions) before executing.
                const confirmMessages = existingActions
                    .map((action) => action.getConfirmationMessage())
                    .filter((message): message is string => !!message);
                if (confirmMessages.length && !await dialog.confirm(confirmMessages.join("\n\n"))) {
                    return;
                }

                // Submit the in-memory action definitions rather than letting the server re-read the
                // stored labels, so a still-in-flight action save can't make the batch run against a
                // stale/empty choice.
                const actions = existingActions.map((action) => ({
                    ...action.actionDef,
                    name: (action.constructor as typeof AbstractBulkAction).actionName
                }));

                await server.post("bulk-action/execute", {
                    noteIds: selectedOrActiveNoteIds,
                    includeDescendants,
                    actions
                });

                toast.showMessage(t("bulk_actions.bulk_actions_executed"), 3000);
                setShown(false);
            }}
            onHidden={() => setShown(false)}
        >
            <h4>{t("bulk_actions.affected_notes")}: <span>{affectedNoteCount}</span></h4>
            <FormCheckbox 
                name="include-descendants" label={t("bulk_actions.include_descendants")}
                currentValue={includeDescendants} onChange={setIncludeDescendants}
            />

            <h4>{t("bulk_actions.available_actions")}</h4>
            <AvailableActionsList />

            <h4>{t("bulk_actions.chosen_actions")}</h4>
            <ExistingActionsList existingActions={existingActions} />
        </Modal>
    )
}

function AvailableActionsList() {
    return <table class="bulk-available-action-list">
        {bulk_action.ACTION_GROUPS.map((actionGroup) => {
            return (
                <tr>
                    <td>{ actionGroup.title }:</td>
                    {actionGroup.actions.map(({ actionName, actionTitle }) =>
                        <Button
                            size="small"
                            text={actionTitle}
                            onClick={() => bulk_action.addAction("_bulkAction", actionName)}
                        />
                    )}
                </tr>
            );
        })}
    </table>;
}

function ExistingActionsList({ existingActions }: { existingActions?: AbstractBulkAction[] }) {
    return (
        <table class="bulk-existing-action-list">
            { existingActions
                ? existingActions
                    .map(action => action.doRender())
                    .filter(renderedAction => renderedAction !== null)            
                : <p>{t("bulk_actions.none_yet")}</p>
            }
        </table>
    );
}
