import "./delete_notes.css";

import type { DeleteNotesPreview } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import froca from "../../services/froca.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import Button from "../react/Button.jsx";
import { Card, CardSection } from "../react/Card.js";
import FormToggle from "../react/FormToggle.js";
import { useTriliumEvent } from "../react/hooks.jsx";
import Modal from "../react/Modal.js";
import NoteLink from "../react/NoteLink.js";
import OptionsRow from "../type_widgets/options/components/OptionsRow.js";

interface CloneInfo {
    totalCloneCount: number;
}

export interface ResolveOptions {
    proceed: boolean;
    deleteAllClones?: boolean;
    eraseNotes?: boolean;
}

interface ShowDeleteNotesDialogOpts {
    branchIdsToDelete?: string[];
    callback?: (opts: ResolveOptions) => void;
    forceDeleteAllClones?: boolean;
}

interface BrokenRelationData {
    noteId: string;
    relationName: string;
    sourceNoteId: string;
}

export default function DeleteNotesDialog() {
    const [ opts, setOpts ] = useState<ShowDeleteNotesDialogOpts>({});
    const [ deleteAllClones, setDeleteAllClones ] = useState(false);
    const [ eraseNotes, setEraseNotes ] = useState(!!opts.forceDeleteAllClones);
    const [ brokenRelations, setBrokenRelations ] = useState<DeleteNotesPreview["brokenRelations"]>([]);
    const [ noteIdsToBeDeleted, setNoteIdsToBeDeleted ] = useState<DeleteNotesPreview["noteIdsToBeDeleted"]>([]);
    const [ shown, setShown ] = useState(false);
    const [ cloneInfo, setCloneInfo ] = useState<CloneInfo>({ totalCloneCount: 0 });
    const okButtonRef = useRef<HTMLButtonElement>(null);

    useTriliumEvent("showDeleteNotesDialog", (opts) => {
        setOpts(opts);
        setDeleteAllClones(false);
        setEraseNotes(!!opts.forceDeleteAllClones);
        setShown(true);
    });

    // Calculate clone information when branches change
    useEffect(() => {
        const { branchIdsToDelete } = opts;
        if (!branchIdsToDelete || branchIdsToDelete.length === 0) {
            setCloneInfo({ totalCloneCount: 0 });
            return;
        }

        async function calculateCloneInfo() {
            const branches = froca.getBranches(branchIdsToDelete!, true);
            const uniqueNoteIds = [...new Set(branches.map(b => b.noteId))];
            const notes = await froca.getNotes(uniqueNoteIds);

            let totalCloneCount = 0;

            for (const note of notes) {
                const parentBranches = note.getParentBranches();
                // Clones are additional parent branches beyond the one being deleted
                const otherBranches = parentBranches.filter(b => !branchIdsToDelete!.includes(b.branchId));
                totalCloneCount += otherBranches.length;
            }

            setCloneInfo({ totalCloneCount });
        }

        calculateCloneInfo();
    }, [opts.branchIdsToDelete]);

    useEffect(() => {
        const { branchIdsToDelete, forceDeleteAllClones } = opts;
        if (!branchIdsToDelete || branchIdsToDelete.length === 0) {
            return;
        }

        server.post<DeleteNotesPreview>("delete-notes-preview", {
            branchIdsToDelete,
            deleteAllClones: forceDeleteAllClones || deleteAllClones
        }).then(response => {
            setBrokenRelations(response.brokenRelations);
            setNoteIdsToBeDeleted(response.noteIdsToBeDeleted);
        });
    }, [ opts, deleteAllClones ]);

    return (
        <Modal
            className="delete-notes-dialog"
            size="xl"
            scrollable
            title={t("delete_notes.title")}
            onShown={() => okButtonRef.current?.focus()}
            onHidden={() => {
                opts.callback?.({ proceed: false });
                setShown(false);
            }}
            footer={<>
                <Button text={t("delete_notes.cancel")}
                    onClick={() => setShown(false)} />
                <Button text={t("delete_notes.delete")} kind="primary"
                    buttonRef={okButtonRef}
                    onClick={() => {
                        opts.callback?.({ proceed: true, deleteAllClones, eraseNotes });
                        setShown(false);
                    }} />
            </>}
            show={shown}
        >
            <Card>
                <CardSection>
                    <DeleteAllClonesOption
                        cloneInfo={cloneInfo}
                        deleteAllClones={deleteAllClones}
                        setDeleteAllClones={setDeleteAllClones}
                    />
                    <OptionsRow
                        name="erase-notes"
                        label={t("delete_notes.erase_notes_label")}
                        description={t("delete_notes.erase_notes_description")}
                    >
                        <FormToggle
                            disabled={opts.forceDeleteAllClones}
                            currentValue={eraseNotes}
                            onChange={setEraseNotes}
                        />
                    </OptionsRow>
                </CardSection>
            </Card>

            <BrokenRelations brokenRelations={brokenRelations} />
            <DeletedNotes noteIdsToBeDeleted={noteIdsToBeDeleted} />
        </Modal>
    );
}

interface DeleteAllClonesOptionProps {
    cloneInfo: CloneInfo;
    deleteAllClones: boolean;
    setDeleteAllClones: (value: boolean) => void;
}

function DeleteAllClonesOption({ cloneInfo, deleteAllClones, setDeleteAllClones }: DeleteAllClonesOptionProps) {
    const { totalCloneCount } = cloneInfo;

    if (totalCloneCount === 0) {
        return null;
    }

    return (
        <OptionsRow
            name="delete-all-clones"
            label={t("delete_notes.clones_label")}
            description={t("delete_notes.delete_clones_description", { count: totalCloneCount })}
        >
            <FormToggle
                currentValue={deleteAllClones}
                onChange={setDeleteAllClones}
            />
        </OptionsRow>
    );
}

function DeletedNotes({ noteIdsToBeDeleted }: { noteIdsToBeDeleted: DeleteNotesPreview["noteIdsToBeDeleted"] }) {
    return (
        <Card heading={t("delete_notes.notes_to_be_deleted", { notesCount: noteIdsToBeDeleted.length })}>
            <CardSection noPadding={noteIdsToBeDeleted.length > 0}>
                {noteIdsToBeDeleted.length ? (
                    <ul className="preview-list">
                        {noteIdsToBeDeleted.map((noteId) => (
                            <li key={noteId}>
                                <NoteLink notePath={noteId} showNotePath showNoteIcon />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className="muted-text">{t("delete_notes.no_note_to_delete")}</span>
                )}
            </CardSection>
        </Card>
    );
}

function BrokenRelations({ brokenRelations }: { brokenRelations: DeleteNotesPreview["brokenRelations"] }) {
    if (!brokenRelations.length) {
        return null;
    }

    const relationsData: BrokenRelationData[] = brokenRelations
        .filter((attr) => attr.value && attr.noteId)
        .map((attr) => ({
            noteId: attr.value!,
            relationName: attr.name,
            sourceNoteId: attr.noteId!
        }));

    return (
        <Card heading={t("delete_notes.broken_relations_to_be_deleted", { relationCount: brokenRelations.length })}>
            <CardSection noPadding>
                <div style={{ overflowX: "auto" }}>
                    <table className="table table-striped">
                        <thead>
                            <tr>
                                <th>{t("delete_notes.table_note_with_relation")}</th>
                                <th>{t("delete_notes.table_relation")}</th>
                                <th>{t("delete_notes.table_points_to")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {relationsData.map((relation, index) => (
                                <tr key={index}>
                                    <td><NoteLink notePath={relation.sourceNoteId} showNoteIcon /></td>
                                    <td><code>{relation.relationName}</code></td>
                                    <td><NoteLink notePath={relation.noteId} showNoteIcon /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardSection>
        </Card>
    );
}
