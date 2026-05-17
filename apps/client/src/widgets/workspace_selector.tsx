import "./workspace_selector.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { dynamicRequire, isElectron } from "../services/utils";

interface Workspace {
    id: string;
    name: string;
    dataDir: string;
    lastAccessed: string;
}

interface WorkspaceRegistry {
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
}

export default function WorkspaceSelector() {
    if (!isElectron()) {
        return null;
    }

    const [registry, setRegistry] = useState<WorkspaceRegistry | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    const currentDbId = glob.dbId;

    useEffect(() => {
        const ipcRenderer = dynamicRequire("electron").ipcRenderer;
        ipcRenderer.invoke("get-workspaces").then((reg: WorkspaceRegistry) => {
            setRegistry(reg);
        });
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

        const ipcRenderer = dynamicRequire("electron").ipcRenderer;
        await ipcRenderer.invoke("open-workspace", workspaceId);
    }

    async function addWorkspace() {
        setIsOpen(false);
        const ipcRenderer = dynamicRequire("electron").ipcRenderer;
        const dirPath = await ipcRenderer.invoke("pick-directory");
        if (!dirPath) return;

        const name = dirPath.split(/[/\\]/).pop() || "New Workspace";
        const workspace = await ipcRenderer.invoke("add-workspace", name, dirPath);
        await ipcRenderer.invoke("open-workspace", workspace.id);
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
