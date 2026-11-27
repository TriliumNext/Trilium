import type { KeyboardActionNames } from "@triliumnext/commons";
import type { Tooltip } from "bootstrap";
import type { RefObject } from "preact";
import { useContext, useDebugValue, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type Component from "../../../components/component";
import keyboard_actions from "../../../services/keyboard_actions";
import { formatShortcut, joinShortcut } from "../../../services/keyboard_shortcut_display";
import type {
    ShortcutHintDefinition, ShortcutHintProvider
} from "../../../services/shortcut_hints";
import shortcuts, {
    type Handler, removeIndividualBinding, type ShortcutBinding
} from "../../../services/shortcuts";
import { randomString } from "../../../services/utils";
import { ParentComponent, refToJQuerySelector } from "../react_utils";
import { useStaticTooltip } from "./tooltip";

export function useStaticTooltipWithKeyboardShortcut(
    elRef: RefObject<Element | null>,
    title: string,
    actionName: KeyboardActionNames | undefined,
    opts?: Omit<Partial<Tooltip.Options>, "title">
) {
    const [ keyboardShortcut, setKeyboardShortcut ] = useState<string[]>();
    // Memoized, since `useStaticTooltip` recreates the tooltip whenever its config changes.
    const config = useMemo(() => {
        if (!keyboardShortcut?.length) return { title, ...opts };

        // The shortcut follows the first line, which names the action; later lines describe it.
        const shortcuts = keyboardShortcut
            .map((shortcut) => joinShortcut(formatShortcut(shortcut)))
            .join(", ");
        const [ name, ...description ] = title.split("\n");
        return { title: [ `${name} (${shortcuts})`, ...description ].join("\n"), ...opts };
    }, [ title, keyboardShortcut, opts ]);
    useStaticTooltip(elRef, config);

    useEffect(() => {
        if (actionName) {
            keyboard_actions.getAction(actionName).then(action => setKeyboardShortcut(action?.effectiveShortcuts));
        }
    }, [actionName]);
}

/**
 * Registers this widget's contextual shortcut hints on its host component. When the user requests
 * contextual shortcut help (Alt+F1 by default), the dispatcher walks up from the focused element
 * and asks each component in the chain to contribute its hints — so these appear only while this
 * widget (or one of its descendants) is focused. The registration is removed automatically on unmount.
 *
 * @param hints the sections to contribute, or a function returning them (use the function form when
 *              the hints depend on component state). Read lazily on each request, so it need not be a
 *              stable reference.
 */
export function useContextualShortcutHints(hints: ShortcutHintDefinition | (() => ShortcutHintDefinition)) {
    const parentComponent = useContext(ParentComponent);
    // Keep the latest hints in a ref so the provider registers once per host rather than
    // re-registering on every render when the caller passes an inline array/function.
    const hintsRef = useRef(hints);
    hintsRef.current = hints;

    useEffect(() => {
        // A standalone Preact root mounted by the content renderer (a media player in a collection tile,
        // an included note) is hosted by appContext itself. Every chain the dispatcher walks ends there,
        // so registering would make these hints show up in *every* context — e.g. a played collection
        // tile adding its Playback section to the image viewer's. Contextual hints need a host that
        // sits inside the focused chain; the root never does.
        if (!parentComponent || parentComponent === appContext) return;

        const provider: ShortcutHintProvider = (collector) => {
            const current = hintsRef.current;
            collector.add(...(typeof current === "function" ? current() : current));
        };
        parentComponent.getContextualShortcutHints = provider;

        return () => {
            // Only clear our own registration, in case another provider replaced it in the meantime.
            if (parentComponent.getContextualShortcutHints === provider) {
                delete parentComponent.getContextualShortcutHints;
            }
        };
    }, [ parentComponent ]);
    useDebugValue("contextual-shortcut-hints");
}

export function useKeyboardShortcuts(
    scope: "code-detail" | "text-detail",
    containerRef: RefObject<HTMLElement | null>,
    parentComponent: Component | undefined,
    ntxId: string | null | undefined
) {
    useEffect(() => {
        if (!parentComponent) return;
        const $container = refToJQuerySelector(containerRef);
        const bindingPromise = keyboard_actions.setupActionsForElement(scope, $container, parentComponent, ntxId);
        return async () => {
            const bindings = await bindingPromise;
            for (const binding of bindings) {
                removeIndividualBinding(binding);
            }
        };
    }, [ scope, containerRef, parentComponent, ntxId ]);
}

/** Marks a container whose `useFindShortcut()` has an explicit note context. */
const FIND_NTX_ID_ATTR = "data-find-ntx-id";

/**
 * Opens "Search in note" on a shortcut of `findInText` pressed inside `containerRef`, for the note
 * context `ntxId`, else for that of the closest container bound with one or of the note split
 * around the container. The window binding of the shortcut targets the active tab, and an embed in
 * a text note keeps its keys from the window.
 */
export function useFindShortcut(containerRef: RefObject<HTMLElement | null>, ntxId?: string) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        if (ntxId) container.setAttribute(FIND_NTX_ID_ATTR, ntxId);
        let bindings: ShortcutBinding[] = [];
        let isDisposed = false;
        void keyboard_actions.getAction("findInText", true).then((action) => {
            if (isDisposed) return;
            bindings = (action?.effectiveShortcuts ?? []).flatMap((shortcut) =>
                shortcuts.bindElShortcut($(container), shortcut, () => {
                    const scope = container.closest(`[${FIND_NTX_ID_ATTR}], [data-ntx-id]`);
                    const contextId = ntxId
                        ?? scope?.getAttribute(FIND_NTX_ID_ATTR)
                        ?? scope?.getAttribute("data-ntx-id")
                        ?? undefined;
                    void appContext.triggerCommand("findInText", { ntxId: contextId });
                }) ?? []);
        });

        return () => {
            isDisposed = true;
            if (ntxId) container.removeAttribute(FIND_NTX_ID_ATTR);
            for (const binding of bindings) {
                removeIndividualBinding(binding);
            }
        };
    }, [ containerRef, ntxId ]);
}

/**
 * Register a global shortcut. Internally it uses the shortcut service and assigns a random namespace to make it unique.
 *
 * @param keyboardShortcut the keyboard shortcut combination to register.
 * @param handler the corresponding handler to be called when the keyboard shortcut is invoked by the user.
 */
export function useGlobalShortcut(keyboardShortcut: string | null | undefined, handler: Handler) {
    useEffect(() => {
        if (!keyboardShortcut) return;
        const namespace = randomString(10);
        shortcuts.bindGlobalShortcut(keyboardShortcut, handler, namespace);
        return () => shortcuts.removeGlobalShortcut(namespace);
    }, [ keyboardShortcut, handler ]);
}
