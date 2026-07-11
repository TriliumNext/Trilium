import "./branch_prefix.css";

import { useRef, useState } from "preact/hooks";

import { type ContextMenuCommandData, default as appContext } from "../../components/app_context.js";
import FBranch from "../../entities/fbranch.js";
import froca from "../../services/froca.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import toast from "../../services/toast.js";
import tree from "../../services/tree.js";
import Button from "../react/Button.jsx";
import { Card, CardSection } from "../react/Card.js";
import FormGroup from "../react/FormGroup.js";
import { useTriliumEvent } from "../react/hooks.jsx";
import Icon from "../react/Icon.js";
import Modal from "../react/Modal.jsx";

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

    return (
        <Modal
            className="branch-prefix-dialog"
            title={branches.length === 1 ? t("branch_prefix.edit_branch_prefix") : t("branch_prefix.edit_branch_prefix_multiple", { count: branches.length })}
            size="lg"
            onShown={() => branchInput.current?.select()}
            onHidden={() => setShown(false)}
            onSubmit={onSubmit}
            helpPageId="TBwsyfadTA18"
            footer={<>
                <Button text={t("branch_prefix.cancel")} onClick={() => setShown(false)} />
                <Button text={t("branch_prefix.save")} kind="primary" />
            </>}
            show={shown}
        >
            <FormGroup label={t("branch_prefix.prefix")} name="prefix" description={t("branch_prefix.description")}>
                <input class="branch-prefix-input form-control" value={prefix} ref={branchInput}
                    onChange={(e) => setPrefix((e.target as HTMLInputElement).value)} />
            </FormGroup>
            <Card heading={t("branch_prefix.preview_in_tree")}>
                <CardSection noPadding>
                    <ul className="preview-list">
                        {branches.map((branch) => {
                            const note = branch.getNoteFromCache();
                            return note && (
                                <li key={branch.branchId}>
                                    <Icon icon={note.getIcon()} />
                                    {prefix && <span className="branch-prefix-current">{prefix} - </span>}
                                    {note.title}
                                </li>
                            );
                        })}
                    </ul>
                </CardSection>
            </Card>
        </Modal>
    );
}

async function savePrefix(branchId: string, prefix: string) {
    await server.put(`branches/${branchId}/set-prefix`, { prefix });
    toast.showMessage(t("branch_prefix.branch_prefix_saved"));
}

async function savePrefixBatch(branchIds: string[], prefix: string) {
    await server.put("branches/set-prefix-batch", { branchIds, prefix });
    toast.showMessage(t("branch_prefix.branch_prefix_saved_multiple", { count: branchIds.length }));
}
