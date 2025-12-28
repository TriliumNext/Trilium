import { useRef, useState } from "preact/hooks";
import appContext from "../../components/app_context.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import toast from "../../services/toast.js";
import Modal from "../react/Modal.jsx";
import froca from "../../services/froca.js";
import tree from "../../services/tree.js";
import Button from "../react/Button.jsx";
import FormGroup from "../react/FormGroup.js";
import { useTriliumEvent } from "../react/hooks.jsx";
import FBranch from "../../entities/fbranch.js";
import type { ContextMenuCommandData } from "../../components/app_context.js";
import "./branch_prefix.css";

// Virtual branches (e.g., from search results) start with this prefix
const VIRTUAL_BRANCH_PREFIX = "virt-";

export default function BranchPrefixDialog() {
    const [ shown, setShown ] = useState(false);
    const [ branches, setBranches ] = useState<FBranch[]>([]);
    const [ prefix, setPrefix ] = useState("");
    const branchInput = useRef<HTMLInputElement>(null);

    useTriliumEvent("editBranchPrefix", async (data?: ContextMenuCommandData) => {
        let branchIds: string[] = [];

        if (data?.selectedOrActiveBranchIds && data.selectedOrActiveBranchIds.length > 0) {
            // Multi-select mode from tree context menu
            branchIds = data.selectedOrActiveBranchIds.filter((branchId) => !branchId.startsWith(VIRTUAL_BRANCH_PREFIX));
        } else {
            // Single branch mode from keyboard shortcut or when no selection
            const notePath = appContext.tabManager.getActiveContextNotePath();
            if (!notePath) {
                return;
            }

            const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);

            if (!noteId || !parentNoteId) {
                return;
            }

            const branchId = await froca.getBranchId(parentNoteId, noteId);
            if (!branchId) {
                return;
            }
            const parentNote = await froca.getNote(parentNoteId);
            if (!parentNote || parentNote.type === "search") {
                return;
            }

            branchIds = [branchId];
        }

        if (branchIds.length === 0) {
            return;
        }

        const newBranches = branchIds
            .map(id => froca.getBranch(id))
            .filter((branch): branch is FBranch => branch !== null);

        if (newBranches.length === 0) {
            return;
        }

        setBranches(newBranches);
        // Use the prefix of the first branch as the initial value
        setPrefix(newBranches[0]?.prefix ?? "");
        setShown(true);
    });

    async function onSubmit() {
        if (branches.length === 0) {
            return;
        }

        if (branches.length === 1) {
            await savePrefix(branches[0].branchId, prefix);
        } else {
            await savePrefixBatch(branches.map(b => b.branchId), prefix);
        }
        setShown(false);
    }

    const isSingleBranch = branches.length === 1;

    return (
        <Modal
            className="branch-prefix-dialog"
            title={isSingleBranch ? t("branch_prefix.edit_branch_prefix") : t("branch_prefix.edit_branch_prefix_multiple", { count: branches.length })}
            size="lg"
            onShown={() => branchInput.current?.focus()}
            onHidden={() => setShown(false)}
            onSubmit={onSubmit}
            helpPageId="TBwsyfadTA18"
            footer={<Button text={t("branch_prefix.save")} />}
            show={shown}
        >
            <FormGroup label={t("branch_prefix.prefix")} name="prefix">
                <div class="input-group">
                    <input class="branch-prefix-input form-control" value={prefix} ref={branchInput}
                        onChange={(e) => setPrefix((e.target as HTMLInputElement).value)} />
                    {isSingleBranch && branches[0] && (
                        <div class="branch-prefix-note-title input-group-text"> - {branches[0].getNoteFromCache()?.title}</div>
                    )}
                </div>
            </FormGroup>
            {!isSingleBranch && (
                <div className="branch-prefix-notes-list">
                    <strong>{t("branch_prefix.affected_branches", { count: branches.length })}</strong>
                    <ul>
                        {branches.map((branch) => {
                            const note = branch.getNoteFromCache();
                            return note && (
                                <li key={branch.branchId}>
                                    {branch.prefix && <span className="branch-prefix-current">{branch.prefix} - </span>}
                                    {note.title}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </Modal>
    );
}

async function savePrefix(branchId: string, prefix: string) {
    await server.put(`branches/${branchId}/set-prefix`, { prefix: prefix });
    toast.showMessage(t("branch_prefix.branch_prefix_saved"));
}

async function savePrefixBatch(branchIds: string[], prefix: string) {
    await server.put("branches/set-prefix-batch", { branchIds, prefix });
    toast.showMessage(t("branch_prefix.branch_prefix_saved_multiple", { count: branchIds.length }));
}
