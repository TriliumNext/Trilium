import server from "./server.js";
import appContext from "../components/app_context.js";
import shortcutService, { ShortcutBinding } from "./shortcuts.js";
import type Component from "../components/component.js";
import type { ActionKeyboardShortcut } from "@triliumnext/commons";

const keyboardActionRepo: Record<string, ActionKeyboardShortcut> = {};

const keyboardActionsLoaded = server.get<ActionKeyboardShortcut[]>("keyboard-actions").then((actions) => {
    actions = actions.filter((a) => !!a.actionName); // filter out separators

    for (const action of actions) {
        action.effectiveShortcuts = (action.effectiveShortcuts ?? []).filter((shortcut) => !shortcut.startsWith("global:"));

        keyboardActionRepo[action.actionName] = action;
    }

    return actions;
});

async function getActions() {
    return await keyboardActionsLoaded;
}

async function getActionsForScope(scope: string) {
    const actions = await keyboardActionsLoaded;

    return actions.filter((action) => action.scope === scope);
}

async function setupActionsForElement(scope: string, $el: JQuery<HTMLElement>, component: Component, ntxId: string | null | undefined) {
    if (!$el[0]) return [];

    const actions = await getActionsForScope(scope);
    const bindings: ShortcutBinding[] = [];

    for (const action of actions) {
        for (const shortcut of action.effectiveShortcuts ?? []) {
            const binding = shortcutService.bindElShortcut($el, shortcut, () => {
                component.triggerCommand(action.actionName, { ntxId });
            });
            if (binding) {
                bindings.push(binding);
            }
        }
    }

    return bindings;
}

getActionsForScope("window").then((actions) => {
    for (const action of actions) {
        for (const shortcut of action.effectiveShortcuts ?? []) {
            shortcutService.bindGlobalShortcut(shortcut, () => appContext.triggerCommand(action.actionName, { ntxId: appContext.tabManager.activeNtxId }));
        }
    }
});

async function getAction(actionName: string, silent = false) {
    await keyboardActionsLoaded;

    const action = keyboardActionRepo[actionName];

    if (!action) {
        if (silent) {
            console.debug(`Cannot find action '${actionName}'`);
        } else {
            throw new Error(`Cannot find action '${actionName}'`);
        }
    }

    return action;
}

export function getActionSync(actionName: string) {
    return keyboardActionRepo[actionName];
}

function updateDisplayedShortcuts($container: JQuery<HTMLElement>) {
    //@ts-ignore
    //TODO: each() does not support async callbacks.
    $container.find("kbd[data-command]").each(async (i, el) => {
        const actionName = $(el).attr("data-command");
        if (!actionName) {
            return;
        }

        const action = await getAction(actionName, true);

        if (action) {
            const keyboardActions = (action.effectiveShortcuts ?? []).join(", ");

            if (keyboardActions || $(el).text() !== "not set") {
                $(el).text(keyboardActions);
            }
        }
    });

    //@ts-ignore
    //TODO: each() does not support async callbacks.
    $container.find("[data-trigger-command]").each(async (i, el) => {
        const actionName = $(el).attr("data-trigger-command");
        if (!actionName) {
            return;
        }
        const action = await getAction(actionName, true);

        if (action) {
            const title = $(el).attr("title");
            const shortcuts = (action.effectiveShortcuts ?? []).join(", ");

            if (title?.includes(shortcuts)) {
                return;
            }

            const newTitle = !title?.trim() ? shortcuts : `${title} (${shortcuts})`;

            $(el).attr("title", newTitle);
        }
    });
}

export default {
    updateDisplayedShortcuts,
    setupActionsForElement,
    getAction,
    getActions,
    getActionsForScope
};
