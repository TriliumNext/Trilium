import "./workspace_selector.css";

import type { WorkspaceRegistry } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { isElectron } from "../services/utils";

export default function WorkspaceSelector() {
    if (!isElectron()) {
        return null;
    }

    const [registry, setRegistry] = useState<WorkspaceRegistry | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    const currentDbId = glob.dbId;

    useEffect(() => {
        window.electronApi?.workspaces.getWorkspaces().then(setRegistry);
    }, []);

    if (!registry) {
        return (
            <div className="workspace-selector" />
        );
    }

    const currentWorkspace = registry.workspaces.find(w => w.id === currentDbId)
        || registry.workspaces.find(w => w.id === registry.activeWorkspaceId)
        || registry.workspaces[0];

    async function openWorkspace(workspaceId: string) {
        setIsOpen(false);
        if (workspaceId === currentDbId) return;

        await window.electronApi?.workspaces.openWorkspace(workspaceId);
    }

    async function addWorkspace() {
        setIsOpen(false);
        const dirPath = await window.electronApi?.workspaces.pickDirectory();
        if (!dirPath) return;

        const name = dirPath.split(/[/\\]/).pop() || "New Workspace";
        const workspace = await window.electronApi?.workspaces.addWorkspace(name, dirPath);
        if (!workspace) return;
        await window.electronApi?.workspaces.openWorkspace(workspace.id);
    }

    return (
        <div className="workspace-selector">
            <button
                className="workspace-selector-trigger"
                onClick={() => setIsOpen(!isOpen)}
                title={t("workspaces.switch_workspace")}
            >
                <span className="workspace-name">{currentWorkspace?.name}</span>
                <span className="bx bx-chevron-down workspace-chevron" />
            </button>

            {isOpen && (
                <div className="workspace-dropdown">
                    {registry.workspaces.map(ws => (
                        <button
                            key={ws.id}
                            className={`workspace-item ${ws.id === currentWorkspace?.id ? "active" : ""}`}
                            onClick={() => openWorkspace(ws.id)}
                        >
                            <span className="bx bx-data workspace-icon" />
                            <span>{ws.name}</span>
                        </button>
                    ))}
                    <div className="workspace-divider" />
                    <button className="workspace-item" onClick={addWorkspace}>
                        <span className="bx bx-plus workspace-icon" />
                        <span>{t("workspaces.add_workspace")}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
