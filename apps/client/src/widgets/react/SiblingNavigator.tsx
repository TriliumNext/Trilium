import "./SiblingNavigator.css";

import type { RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import type { ViewScope } from "../../services/link";
import type LoadResults from "../../services/load_results";
import { useStaticTooltip, useTriliumEvent } from "./hooks";
import { codeToSiblingDirection, getParentFromNotePath, getSiblingNavigation, isInteractiveTarget, isTextEntryTarget, sameRoleAttachments } from "./sibling_navigation";

const NO_KEYS: readonly string[] = [];

interface SiblingNavigatorProps {
    note?: FNote;
    noteContext?: NoteContext;
    /** When it carries an `attachmentId`, navigation operates over the note's attachments instead of its siblings. */
    viewScope?: ViewScope;
    /** For note siblings, match this type; defaults to the current note's type. (Ignored for attachments.) */
    siblingType?: string;
    /** i18n translation key (resolved via `t()`) for the previous-button tooltip; receives the target's title as `{{title}}`. E.g. `"image_navigation.previous"`. */
    previousTooltipI18nKey: string;
    /** i18n translation key (resolved via `t()`) for the next-button tooltip; receives the target's title as `{{title}}`. E.g. `"image_navigation.next"`. */
    nextTooltipI18nKey: string;
    /**
     * Optional element to scope keyboard navigation to: keys act only while focus is inside it. When
     * omitted, navigation is scoped to the active tab/pane instead, so it works without any wiring.
     */
    keyboardTarget?: RefObject<HTMLElement | null>;
    /** Extra `KeyboardEvent.code`s that trigger previous/next, on top of PageUp/PageDown. */
    extraPreviousKeys?: readonly string[];
    extraNextKeys?: readonly string[];
}

export interface SiblingNavigationState {
    index: number;
    total: number;
    previousId: string;
    nextId: string;
    previousTitle: string;
    nextTitle: string;
    navigatePrevious: () => void;
    navigateNext: () => void;
    navigateFirst: () => void;
    navigateLast: () => void;
}

/**
 * The iterator behind sibling navigation: where the ordered siblings come from, which one is current,
 * how to move to one, and which entity changes should refresh the list. Swapping it switches navigation
 * between notes and attachments — see {@link noteSiblingProvider} / {@link attachmentSiblingProvider}.
 */
export interface SiblingNavigationProvider {
    /** Id of the item currently shown (a noteId or attachmentId); undefined when there is nothing to navigate. */
    currentId: string | undefined;
    /** Changes whenever the loaded collection or current item changes; used as the load effect's key. */
    depsKey: string;
    /** Loads the ordered siblings (including the current item) as `{ id, title }`. */
    loadSiblings(): Promise<{ id: string; title: string }[]>;
    /** Navigates the current tab to the sibling with the given id. */
    navigateTo(id: string): void;
    /** Whether an `entitiesReloaded` event touches this collection (given the currently-loaded ids). */
    shouldRefresh(loadResults: LoadResults, currentSiblingIds: string[]): boolean;
}

/**
 * Floating previous/next navigation between a note's same-type siblings — or, when shown over a single
 * attachment, the note's same-role attachments — with a "<index>/<total>" indicator and tooltips naming
 * the target. The iterator is chosen automatically from the view (no caller wiring). Tooltip text comes
 * from the caller-provided i18n keys. Renders nothing when there is no sibling to move between.
 */
export default function SiblingNavigator({ note, noteContext, viewScope, siblingType, previousTooltipI18nKey, nextTooltipI18nKey, keyboardTarget, extraPreviousKeys = NO_KEYS, extraNextKeys = NO_KEYS }: SiblingNavigatorProps) {
    const previousRef = useRef<HTMLButtonElement>(null);
    const nextRef = useRef<HTMLButtonElement>(null);

    // Viewing a single attachment → cycle the note's attachments; otherwise its note siblings.
    const provider = viewScope?.attachmentId
        ? attachmentSiblingProvider(note, noteContext, viewScope)
        : noteSiblingProvider(note, noteContext, { type: siblingType });
    const navigation = useSiblingNavigation(provider);
    useSiblingKeyboard(navigation, noteContext, keyboardTarget, extraPreviousKeys, extraNextKeys);

    const previousText = navigation ? t(previousTooltipI18nKey, { title: navigation.previousTitle }) : "";
    const nextText = navigation ? t(nextTooltipI18nKey, { title: navigation.nextTitle }) : "";
    // Memoize so the bootstrap tooltip is only recreated when the target's name actually changes.
    const previousConfig = useMemo(() => ({ title: previousText, placement: "bottom" as const }), [ previousText ]);
    const nextConfig = useMemo(() => ({ title: nextText, placement: "bottom" as const }), [ nextText ]);
    useStaticTooltip(previousRef, previousConfig);
    useStaticTooltip(nextRef, nextConfig);

    if (!navigation) return null;

    return (
        <div className="sibling-navigator">
            <button
                ref={previousRef}
                type="button"
                className="icon-action bx bx-chevron-left"
                aria-label={previousText}
                onClick={() => navigation.navigatePrevious()}
            />
            <span className="sibling-navigator-index">{navigation.index}/{navigation.total}</span>
            <button
                ref={nextRef}
                type="button"
                className="icon-action bx bx-chevron-right"
                aria-label={nextText}
                onClick={() => navigation.navigateNext()}
            />
        </div>
    );
}

/**
 * Generic sibling-navigation engine over a {@link SiblingNavigationProvider}: loads the siblings, keeps
 * them fresh across entity/froca reloads, and exposes the current index/total plus prev/next/first/last
 * navigation. Returns null when there is nothing to navigate.
 */
export function useSiblingNavigation(provider: SiblingNavigationProvider): SiblingNavigationState | null {
    const [ siblings, setSiblings ] = useState<{ id: string; title: string }[]>([]);
    const [ refreshCounter, setRefreshCounter ] = useState(0);
    const providerRef = useRef(provider);
    providerRef.current = provider;

    const { currentId, depsKey } = provider;

    useEffect(() => {
        let active = true;
        providerRef.current.loadSiblings()
            .then((loaded) => { if (active) setSiblings(loaded); })
            .catch(() => { if (active) setSiblings([]); });
        return () => { active = false; };
    }, [ depsKey, refreshCounter ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (providerRef.current.shouldRefresh(loadResults, siblings.map((sibling) => sibling.id))) {
            setRefreshCounter((counter) => counter + 1);
        }
    });

    // froca replaces every cached entity on a full reload (e.g. a protected-session unlock), refreshing titles.
    useTriliumEvent("frocaReloaded", () => setRefreshCounter((counter) => counter + 1));

    if (!currentId) return null;
    const navigation = getSiblingNavigation(siblings.map((sibling) => sibling.id), currentId);
    if (!navigation) return null;

    const titleOf = (id: string) => siblings.find((sibling) => sibling.id === id)?.title ?? "";
    const navigateTo = (id: string) => providerRef.current.navigateTo(id);
    return {
        index: navigation.index,
        total: navigation.total,
        previousId: navigation.previous,
        nextId: navigation.next,
        previousTitle: titleOf(navigation.previous),
        nextTitle: titleOf(navigation.next),
        navigatePrevious: () => navigateTo(navigation.previous),
        navigateNext: () => navigateTo(navigation.next),
        navigateFirst: () => navigateTo(navigation.first),
        navigateLast: () => navigateTo(navigation.last)
    };
}

/** Filter for note siblings: a note type (defaults to the current note's), optionally narrowed by a mime prefix. */
export interface NoteSiblingFilter {
    type?: string;
    mimePrefix?: string;
}

/** Iterator over the current note's matching siblings within the parent of the current tab (clone-aware). */
export function noteSiblingProvider(note: FNote | undefined, noteContext: NoteContext | undefined, filter: NoteSiblingFilter = {}): SiblingNavigationProvider {
    const notePath = noteContext?.notePath;
    const type = filter.type ?? note?.type;
    const { mimePrefix } = filter;
    const parent = getParentFromNotePath(notePath);
    const matches = (sibling: FNote) => sibling.type === type && (!mimePrefix || !!sibling.mime?.startsWith(mimePrefix));
    return {
        currentId: note?.noteId,
        depsKey: `note:${parent?.parentPath ?? ""}:${type ?? ""}:${mimePrefix ?? ""}`,
        loadSiblings: async () => {
            if (!parent || !type) return [];
            const parentNote = await froca.getNote(parent.parentNoteId);
            const children = (await parentNote?.getChildNotes()) ?? [];
            return children.filter(matches).map((child) => ({ id: child.noteId, title: child.title }));
        },
        navigateTo: (id) => { if (parent) void noteContext?.setNote(`${parent.parentPath}/${id}`); },
        shouldRefresh: (loadResults, currentSiblingIds) => {
            if (!parent) return false;
            const branchesChanged = loadResults.getBranchRows().some((branch) => branch.parentNoteId === parent.parentNoteId);
            const siblingChanged = loadResults.getNoteIds().some((noteId) => currentSiblingIds.includes(noteId));
            return branchesChanged || siblingChanged;
        }
    };
}

/** Iterator over the note's same-role attachments, with the role taken from the currently-shown attachment. */
function attachmentSiblingProvider(note: FNote | undefined, noteContext: NoteContext | undefined, viewScope: ViewScope): SiblingNavigationProvider {
    const notePath = noteContext?.notePath;
    const attachmentId = viewScope.attachmentId;
    // Key on the role rather than the id, so cycling same-role attachments doesn't re-fetch the list.
    const role = note?.attachments?.find((attachment) => attachment.attachmentId === attachmentId)?.role;
    return {
        currentId: attachmentId,
        depsKey: `attachment:${note?.noteId ?? ""}:${role ?? attachmentId ?? ""}`,
        loadSiblings: async () => {
            if (!note) return [];
            return sameRoleAttachments(Array.from(await note.getAttachments()), attachmentId);
        },
        navigateTo: (id) => { if (notePath) void noteContext?.setNote(notePath, { viewScope: { ...viewScope, attachmentId: id } }); },
        shouldRefresh: (loadResults) => !!note && loadResults.getAttachmentRows().some((row) => row.ownerId === note.noteId)
    };
}

/**
 * Drives sibling navigation from the keyboard. A single document-level listener (stable across the
 * viewer remounting on each navigation) maps PageUp/PageDown — Home/End too unless `edgeKeys` is false
 * (media players reserve those for seeking) — plus any caller-provided extra keys, to previous/next. It
 * acts only when a `keyboardTarget` (if given) holds focus, otherwise when the note context is the
 * active tab/pane, and never while the user is typing in a text field.
 */
export function useSiblingKeyboard(
    navigation: SiblingNavigationState | null,
    noteContext: NoteContext | undefined,
    keyboardTarget: RefObject<HTMLElement | null> | undefined,
    extraPreviousKeys: readonly string[],
    extraNextKeys: readonly string[],
    options: { edgeKeys?: boolean } = {}
) {
    const { edgeKeys = true } = options;
    // Read the freshest values from inside the listener without re-attaching it on every change.
    const stateRef = useRef({ navigation, noteContext, keyboardTarget, extraPreviousKeys, extraNextKeys, edgeKeys });
    stateRef.current = { navigation, noteContext, keyboardTarget, extraPreviousKeys, extraNextKeys, edgeKeys };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

            const { navigation, noteContext, keyboardTarget, extraPreviousKeys, extraNextKeys, edgeKeys } = stateRef.current;
            const target = e.target as Element | null;
            if (!navigation || isTextEntryTarget(target)) return;
            // Don't hijack Space from a focused button or other interactive control — it activates them.
            if (e.code === "Space" && isInteractiveTarget(target)) return;
            if (keyboardTarget) {
                if (!keyboardTarget.current?.contains(document.activeElement)) return;
            } else if (noteContext && !noteContext.isActive()) {
                return;
            }

            const direction = codeToSiblingDirection(e.code, extraPreviousKeys, extraNextKeys, edgeKeys);
            if (!direction) return;
            e.preventDefault();
            if (direction === "previous") navigation.navigatePrevious();
            else if (direction === "next") navigation.navigateNext();
            else if (direction === "first") navigation.navigateFirst();
            else navigation.navigateLast();
        };

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);
}
