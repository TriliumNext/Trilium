import type { KeyboardActionNames } from "@triliumnext/commons";

import type Component from "../components/component";

/**
 * A single contextual shortcut hint. Either:
 * - references a registered keyboard action, so the "Shortcut Hints" pane shows the user's current
 *   (rebindable) binding formatted for their platform; or
 * - lists literal keys for widget-local shortcuts that aren't in the global action registry (e.g.
 *   the image viewer's zoom `+` / `-` / `0`).
 *
 * `labelKey` is an i18n key describing what the shortcut does. It is optional for the `action`
 * variant (the pane falls back to the action's friendly name) and required for the `keys` variant.
 */
export type ShortcutHint =
    | { action: KeyboardActionNames; labelKey?: string }
    | { keys: string[]; labelKey: string };

/** A titled group of hints (e.g. "Zoom", "Navigation"). Omit `titleKey` for an untitled group. */
export interface ShortcutHintSection {
    /** i18n key for the section header. */
    titleKey?: string;
    hints: ShortcutHint[];
}

/** The declarative shape a widget defines and hands to `useContextualShortcutHints`. */
export type ShortcutHintDefinition = ShortcutHintSection[];

/**
 * Handed to a component's {@link ShortcutHintProvider} so it can push its sections in. Because the
 * dispatcher walks *up* the focused ancestor chain, several components can each contribute a
 * section (e.g. the image viewer's keys plus a global section beneath), so this only ever appends.
 */
export class ShortcutHintCollector {
    readonly sections: ShortcutHintSection[] = [];

    add(...sections: ShortcutHintSection[]) {
        this.sections.push(...sections);
    }
}

export type ShortcutHintProvider = (collector: ShortcutHintCollector) => void;

/**
 * Walks up from `startComponent` through its ancestors, letting each contribute its sections. The
 * focused widget's hints come first, broader/global ones below.
 */
export function collectShortcutHints(startComponent: Component | null | undefined): ShortcutHintSection[] {
    const collector = new ShortcutHintCollector();
    let component: Component | undefined = startComponent ?? undefined;
    while (component) {
        component.getContextualShortcutHints?.(collector);
        component = component.parent as Component | undefined;
    }
    return collector.sections;
}

declare module "../components/component" {
    export default interface Component {
        /**
         * Contributes this component's contextual shortcut hints. Implemented directly by legacy
         * widgets, or via the `useContextualShortcutHints` hook for React components. Called on each
         * component in the focused ancestor chain when the user requests contextual shortcut help,
         * so the hints appear only while this widget (or a descendant) is focused.
         */
        getContextualShortcutHints?: ShortcutHintProvider;
    }
}
