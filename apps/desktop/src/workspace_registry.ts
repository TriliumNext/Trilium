import { app } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface Workspace {
    id: string;
    name: string;
    dataDir: string;
    lastAccessed: string;
}

export interface WorkspaceRegistry {
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
}

function getRegistryPath(): string {
    return path.join(app.getPath("appData"), "TriliumNext", "workspaces.json");
}

export function loadRegistry(): WorkspaceRegistry {
    const registryPath = getRegistryPath();
    try {
        if (fs.existsSync(registryPath)) {
            const data = fs.readFileSync(registryPath, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Failed to load workspace registry:", e);
    }
    return { workspaces: [], activeWorkspaceId: null };
}

export function saveRegistry(registry: WorkspaceRegistry): void {
    const registryPath = getRegistryPath();
    const dir = path.dirname(registryPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

export function addWorkspace(name: string, dataDir: string): Workspace {
    const registry = loadRegistry();
    const workspace: Workspace = {
        id: crypto.randomBytes(9).toString("base64url"),
        name,
        dataDir,
        lastAccessed: new Date().toISOString()
    };
    registry.workspaces.push(workspace);
    saveRegistry(registry);
    return workspace;
}

export function removeWorkspace(id: string): void {
    const registry = loadRegistry();
    registry.workspaces = registry.workspaces.filter(w => w.id !== id);
    if (registry.activeWorkspaceId === id) {
        registry.activeWorkspaceId = registry.workspaces[0]?.id || null;
    }
    saveRegistry(registry);
}

export function getActiveWorkspace(): Workspace | null {
    const registry = loadRegistry();
    if (!registry.activeWorkspaceId) return registry.workspaces[0] || null;
    return registry.workspaces.find(w => w.id === registry.activeWorkspaceId) || registry.workspaces[0] || null;
}

export function setActiveWorkspace(id: string): void {
    const registry = loadRegistry();
    registry.activeWorkspaceId = id;
    const workspace = registry.workspaces.find(w => w.id === id);
    if (workspace) {
        workspace.lastAccessed = new Date().toISOString();
    }
    saveRegistry(registry);
}

/**
 * Ensure the current data directory is registered as a workspace.
 * Called on first startup to migrate existing single-DB users.
 */
export function ensureCurrentDbRegistered(dataDir: string, instanceName?: string): Workspace {
    const registry = loadRegistry();
    const existing = registry.workspaces.find(w => w.dataDir === dataDir);
    if (existing) {
        return existing;
    }

    const workspace: Workspace = {
        id: crypto.randomBytes(9).toString("base64url"),
        name: instanceName || "Default",
        dataDir,
        lastAccessed: new Date().toISOString()
    };
    registry.workspaces.push(workspace);
    if (!registry.activeWorkspaceId) {
        registry.activeWorkspaceId = workspace.id;
    }
    saveRegistry(registry);
    return workspace;
}
