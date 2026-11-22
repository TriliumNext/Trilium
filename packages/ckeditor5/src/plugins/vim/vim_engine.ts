import type { CodeMirrorConstructor, Vim } from "@replit/codemirror-vim-core";

import VimAdapter from "./vim_adapter.js";
import { addTriliumKeys, installTriliumCommands } from "./vim_commands.js";

let loading: Promise<Vim> | null = null;
let loaded: Vim | null = null;
/** The startup commands that ran last, or `null` before any ran. */
let lastStartupCommands: string | null = null;

/**
 * The Vim engine, loaded on first use and shared by every text editor, which then share the
 * registers. Code notes have an engine of their own.
 */
export function loadVimEngine(): Promise<Vim> {
    loading ??= import("@replit/codemirror-vim-core").then(({ initVim }) => {
        const vim = initVim(VimAdapter as unknown as CodeMirrorConstructor);
        installTriliumCommands(vim);
        loaded = vim;
        return vim;
    });
    return loading;
}

/** The Vim engine, when it has loaded already. */
export function getLoadedVimEngine(): Vim | null {
    return loaded;
}

/**
 * Runs `commands`, one Ex command per line, such as `imap jj <Esc>`, unless they ran last. New
 * commands replace the mappings that the previous ones made. A line starting with `"` is a comment.
 */
export function runStartupCommands(vim: Vim, cm: VimAdapter, commands: string) {
    if (commands === lastStartupCommands) {
        return;
    }
    if (lastStartupCommands !== null) {
        vim.mapclear();
        addTriliumKeys(vim);
    }
    lastStartupCommands = commands;
    for (const line of commands.split("\n")) {
        const command = line.trim().replace(/^:/, "");
        if (!command || command.startsWith("\"")) {
            continue;
        }
        try {
            vim.handleEx(cm as never, command);
        } catch (error) {
            console.warn(`The Vim startup command "${command}" failed.`, error);
        }
    }
}
