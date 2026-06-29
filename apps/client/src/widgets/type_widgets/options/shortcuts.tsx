import "./shortcuts.css";

import { ActionKeyboardShortcut, KeyboardShortcut, OptionNames } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import { ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import options from "../../../services/options";
import server from "../../../services/server";
import { canonicalizeShortcut, KEYCODES_WITH_NO_MODIFIER } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import { arrayEqual, isElectron, isMobile, reloadFrontendApp } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import { Badge } from "../../react/Badge";
import Button from "../../react/Button";
import Dropdown from "../../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../../react/FormList";
import FormTextBox from "../../react/FormTextBox";
import { useStaticTooltip, useTriliumEvent } from "../../react/hooks";
import { TooltipIcon } from "../../react/Icon";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function ShortcutSettings() {
    const [ keyboardShortcuts, setKeyboardShortcuts ] = useState<KeyboardShortcut[]>([]);
    const [ filter, setFilter ] = useState<string>();
    const [ activeFilter, setActiveFilter ] = useState<ShortcutFilter>(null);
    const filterDropdownRef = useRef<BootstrapDropdown>(null);

    const selectFilter = useCallback((value: ShortcutFilter) => {
        setActiveFilter(value);
        filterDropdownRef.current?.hide();
    }, []);

    useEffect(() => {
        server.get<KeyboardShortcut[]>("keyboard-actions").then(setKeyboardShortcuts);
    }, []);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const optionNames = loadResults.getOptionNames();
        if (!optionNames || !optionNames.length) {
            return;
        }

        let updatedShortcuts: (KeyboardShortcut[] | null) = null;

        for (const optionName of optionNames) {
            if (!(optionName.startsWith(PREFIX))) {
                continue;
            }

            const actionName = getActionNameFromOptionName(optionName);
            const index = keyboardShortcuts.findIndex(s => "actionName" in s && s.actionName === actionName);
            const correspondingShortcut = keyboardShortcuts[index];
            if (correspondingShortcut && "effectiveShortcuts" in correspondingShortcut) {
                // Replace the matched entry with a fresh object rather than mutating state in place,
                // which would violate Preact's immutability contract.
                updatedShortcuts ??= Array.from(keyboardShortcuts);
                updatedShortcuts[index] = {
                    ...correspondingShortcut,
                    effectiveShortcuts: JSON.parse(options.get(optionName))
                };
            }
        }

        if (updatedShortcuts) {
            setKeyboardShortcuts(updatedShortcuts);
        }
    });

    const resetShortcuts = useCallback(async () => {
        if (!(await dialog.confirm(t("shortcuts.confirm_reset")))) {
            return;
        }

        const optionsToSet: Record<string, string> = {};
        for (const keyboardShortcut of keyboardShortcuts) {
            if (!("effectiveShortcuts" in keyboardShortcut) || !keyboardShortcut.effectiveShortcuts) {
                continue;
            }

            const defaultShortcuts = keyboardShortcut.defaultShortcuts ?? [];
            if (!arrayEqual(keyboardShortcut.effectiveShortcuts, defaultShortcuts)) {
                optionsToSet[getOptionName(keyboardShortcut.actionName)] = JSON.stringify(defaultShortcuts);
            }
        }
        options.saveMany(optionsToSet);
    }, [ keyboardShortcuts ]);

    const filterLowerCase = filter?.toLowerCase() ?? "";
    const groups = useMemo(() => groupShortcuts(keyboardShortcuts), [ keyboardShortcuts ]);
    const conflicts = useMemo(() => computeConflicts(keyboardShortcuts), [ keyboardShortcuts ]);
    const conflictGroups = useMemo(() => computeConflictGroups(keyboardShortcuts), [ keyboardShortcuts ]);
    // Count distinct clashing key combinations, not the number of actions involved: two actions on one
    // key is a single conflict, not two.
    const conflictCount = conflictGroups.length;
    const globalCount = useMemo(() => keyboardShortcuts.filter((s) => "actionName" in s && hasGlobalShortcut(s)).length, [ keyboardShortcuts ]);
    const modifiedCount = useMemo(() => keyboardShortcuts.filter((s) => "actionName" in s && isShortcutModified(s)).length, [ keyboardShortcuts ]);

    // When filtering by conflicts, group the actions by the combination they collide on instead of
    // by their settings section, so the colliding actions sit together.
    const filteredGroups = (activeFilter === "conflicts" ? conflictGroups : groups)
        .map((group) => ({
            ...group,
            actions: group.actions.filter((action) =>
                matchesFilter(action, activeFilter, conflicts) &&
                (!filter || filterKeyboardAction(action, filterLowerCase)))
        }))
        .filter((group) => group.actions.length > 0);

    return (
        <>
            <OptionsPageHeader
                actions={
                    <div className="shortcut-header-buttons">
                        {conflictCount > 0 &&
                        <Badge
                            className={`shortcut-conflicts-badge ${activeFilter === "conflicts" ? "active" : ""}`}
                            icon="bx bx-error-circle"
                            text={t("shortcuts.conflicts_badge", { count: conflictCount })}
                            tooltip={t("shortcuts.conflicts_badge_tooltip")}
                            outline
                            onClick={() => setActiveFilter(activeFilter === "conflicts" ? null : "conflicts")}
                        />}
                        <Button
                            text={t("shortcuts.reload_app")}
                            onClick={reloadFrontendApp}
                            size="micro"
                        />
                        <Button
                            text={t("shortcuts.set_all_to_default")}
                            onClick={resetShortcuts}
                            size="micro"
                        />
                    </div>
                }
                below={
                    <div className="shortcut-header-filter">
                        <FormTextBox
                            placeholder={t("shortcuts.type_text_to_filter")}
                            currentValue={filter} onChange={(value) => setFilter(value)}
                        />
                        <Dropdown
                            buttonClassName={`bx bx-filter-alt ${activeFilter ? "active" : ""}`}
                            hideToggleArrow
                            noSelectButtonStyle
                            noDropdownListStyle
                            iconAction
                            title={t("shortcuts.filter")}
                            dropdownRef={filterDropdownRef}
                            dropdownContainerClassName={isMobile() ? "mobile-bottom-menu" : undefined}
                        >
                            <FilterContent
                                activeFilter={activeFilter}
                                onSelect={selectFilter}
                                conflictCount={conflictCount}
                                globalCount={globalCount}
                                modifiedCount={modifiedCount}
                            />
                        </Dropdown>
                    </div>
                }
            />

            <div className="shortcuts-options-section">
                {filteredGroups.length > 0
                    ? filteredGroups.map((group) => (
                        <OptionsSection key={group.title} title={group.title}>
                            {group.actions.map((action) => (
                                <ShortcutRow key={action.actionName} action={action} conflicts={conflicts.get(action.actionName)} />
                            ))}
                        </OptionsSection>
                    ))
                    : filter
                        ? (
                            <NoItems
                                icon="bx bx-filter-alt"
                                text={t("shortcuts.no_results", { filter })}
                            />
                        )
                        : activeFilter === "conflicts" && conflictCount === 0
                            ? (
                                <NoItems
                                    icon="bx bx-check-circle"
                                    text={t("shortcuts.no_conflicts")}
                                />
                            )
                            : (
                                <NoItems
                                    icon="bx bx-filter-alt"
                                    text={t("shortcuts.no_matches")}
                                />
                            )}
            </div>
        </>
    );
}

interface ShortcutGroup {
    title: string;
    actions: ActionKeyboardShortcut[];
}

export function groupShortcuts(shortcuts: KeyboardShortcut[]): ShortcutGroup[] {
    const groups: ShortcutGroup[] = [];

    for (const shortcut of shortcuts) {
        if ("separator" in shortcut) {
            groups.push({ title: shortcut.separator, actions: [] });
        } else {
            groups[groups.length - 1]?.actions.push(shortcut);
        }
    }

    return groups;
}

/**
 * Maps a single shortcut string (as stored, e.g. `Ctrl+J` or `global:Ctrl+J`) to the friendly names
 * of the *other* actions that fire on the same physical combination.
 */
type ShortcutConflicts = Map<string, string[]>;

type ShortcutScope = ActionKeyboardShortcut["scope"];

/**
 * Whether two shortcuts attached at the given scopes can fire on the same keystroke. A `window`-scoped
 * shortcut is bound to the whole window, so it overlaps every other scope; two more specific scopes
 * (e.g. `text-detail` vs `code-detail`) target mutually-exclusive contexts and never collide unless
 * they are the same. An undefined scope is treated as `window` (the most permissive default).
 */
function scopesConflict(a: ShortcutScope, b: ShortcutScope) {
    const scopeA = a ?? "window";
    const scopeB = b ?? "window";
    return scopeA === scopeB || scopeA === "window" || scopeB === "window";
}

/**
 * Detects shortcut conflicts in a single O(total shortcuts) pass and returns a render-ready lookup:
 * `actionName → (shortcut string → conflicting action names)`. A row not present in the map has no
 * conflicts, and a shortcut not present on a row's entry is conflict-free — so the render path is
 * just two cheap map lookups, with all the canonicalization done up front.
 *
 * Two shortcuts conflict when their {@link canonicalizeShortcut} forms match *and* their scopes
 * overlap (see {@link scopesConflict}). The `global:` prefix is stripped first: an OS-level global
 * shortcut still swallows the same combination an in-app one wants.
 */
export function computeConflicts(shortcuts: KeyboardShortcut[]): Map<string, ShortcutConflicts> {
    // First pass: bucket every action by the canonical combination of each of its shortcuts.
    const byCombo = new Map<string, ActionKeyboardShortcut[]>();
    for (const shortcut of shortcuts) {
        if (!("actionName" in shortcut)) {
            continue;
        }

        for (const combo of shortcut.effectiveShortcuts ?? []) {
            const key = canonicalizeShortcut(stripGlobalPrefix(combo));
            if (!key) {
                continue;
            }

            let actions = byCombo.get(key);
            if (!actions) {
                byCombo.set(key, actions = []);
            }
            if (!actions.includes(shortcut)) {
                actions.push(shortcut);
            }
        }
    }

    // Second pass: for combinations shared by 2+ actions, record the conflicting names per action.
    const result = new Map<string, ShortcutConflicts>();
    for (const shortcut of shortcuts) {
        if (!("actionName" in shortcut)) {
            continue;
        }

        for (const combo of shortcut.effectiveShortcuts ?? []) {
            const actions = byCombo.get(canonicalizeShortcut(stripGlobalPrefix(combo)));
            if (!actions || actions.length < 2) {
                continue;
            }

            const others = actions
                .filter((other) => other !== shortcut && scopesConflict(shortcut.scope, other.scope))
                .map((other) => other.friendlyName ?? other.actionName);
            if (!others.length) {
                continue;
            }

            let perShortcut = result.get(shortcut.actionName);
            if (!perShortcut) {
                result.set(shortcut.actionName, perShortcut = new Map());
            }
            perShortcut.set(combo, [ ...new Set(others) ]);
        }
    }

    return result;
}

/**
 * Groups conflicting actions by the key combination they collide on, for the "Conflicts" filter view.
 * Each returned group is titled with the combination (e.g. `Ctrl+0`) and lists every action bound to
 * it that conflicts with another (scope-aware — see {@link scopesConflict}). An action with two
 * conflicting shortcuts appears under both combinations. Shaped like {@link groupShortcuts} so it
 * drops straight into the same render path.
 */
export function computeConflictGroups(shortcuts: KeyboardShortcut[]): ShortcutGroup[] {
    const byCombo = new Map<string, { display: string; actions: ActionKeyboardShortcut[] }>();
    for (const shortcut of shortcuts) {
        if (!("actionName" in shortcut)) {
            continue;
        }

        for (const combo of shortcut.effectiveShortcuts ?? []) {
            const bare = stripGlobalPrefix(combo);
            const key = canonicalizeShortcut(bare);
            if (!key) {
                continue;
            }

            let group = byCombo.get(key);
            if (!group) {
                // The first stored form of the combination is used as the readable group title.
                byCombo.set(key, group = { display: bare, actions: [] });
            }
            if (!group.actions.includes(shortcut)) {
                group.actions.push(shortcut);
            }
        }
    }

    const groups: ShortcutGroup[] = [];
    for (const { display, actions } of byCombo.values()) {
        const conflicting = actions.filter((a) => actions.some((b) => b !== a && scopesConflict(a.scope, b.scope)));
        if (conflicting.length >= 2) {
            groups.push({ title: display, actions: conflicting });
        }
    }
    return groups;
}

/**
 * The active list filter: `"conflicts"` keeps only actions involved in a conflict, `"global"` keeps
 * only actions that have a system-wide (global) shortcut, `"modified"` keeps only actions whose
 * shortcuts differ from their default, and `null` applies no restriction.
 */
type ShortcutFilter = "conflicts" | "global" | "modified" | null;

function hasGlobalShortcut(action: ActionKeyboardShortcut) {
    return (action.effectiveShortcuts ?? []).some(isGlobalShortcut);
}

export function matchesFilter(action: ActionKeyboardShortcut, activeFilter: ShortcutFilter, conflicts: Map<string, ShortcutConflicts>) {
    switch (activeFilter) {
        case "conflicts":
            return conflicts.has(action.actionName);
        case "global":
            return hasGlobalShortcut(action);
        case "modified":
            return isShortcutModified(action);
        default:
            return true;
    }
}

function FilterContent({ activeFilter, onSelect, conflictCount, globalCount, modifiedCount }: {
    activeFilter: ShortcutFilter;
    onSelect: (value: ShortcutFilter) => void;
    conflictCount: number;
    globalCount: number;
    modifiedCount: number;
}) {
    return (
        <>
            <FormListItem
                checked={activeFilter === null}
                onClick={() => onSelect(null)}
            >{t("shortcuts.filter_all")}</FormListItem>
            <FormDropdownDivider />
            <FormListItem
                checked={activeFilter === "conflicts"}
                disabled={conflictCount === 0}
                onClick={() => onSelect("conflicts")}
            >{t("shortcuts.filter_conflicts", { count: conflictCount })}</FormListItem>
            <FormListItem
                checked={activeFilter === "global"}
                disabled={globalCount === 0}
                onClick={() => onSelect("global")}
            >{t("shortcuts.filter_global", { count: globalCount })}</FormListItem>
            <FormListItem
                checked={activeFilter === "modified"}
                disabled={modifiedCount === 0}
                onClick={() => onSelect("modified")}
            >{t("shortcuts.filter_modified", { count: modifiedCount })}</FormListItem>
        </>
    );
}

function isShortcutModified(action: ActionKeyboardShortcut) {
    return !arrayEqual(action.effectiveShortcuts ?? [], action.defaultShortcuts ?? []);
}

function revertShortcut(action: ActionKeyboardShortcut) {
    void options.save(getOptionName(action.actionName), JSON.stringify(action.defaultShortcuts ?? []));
}

function formatDefaultShortcuts(action: ActionKeyboardShortcut) {
    return action.defaultShortcuts?.length
        ? action.defaultShortcuts.join(", ")
        : t("shortcuts.no_default_shortcut");
}

export function filterKeyboardAction(action: ActionKeyboardShortcut, filter: string) {
    return action.actionName.toLowerCase().includes(filter) ||
        (action.friendlyName && action.friendlyName.toLowerCase().includes(filter)) ||
        (action.defaultShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
        (action.effectiveShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
        (action.description && action.description.toLowerCase().includes(filter));
}

function ShortcutRow({ action, conflicts }: { action: ActionKeyboardShortcut; conflicts?: ShortcutConflicts }) {
    return (
        <OptionsRow
            name={action.actionName}
            label={
                <>
                    {isShortcutModified(action) &&
                        <TooltipIcon className="shortcut-modified-indicator" tooltip={t("shortcuts.modified_from_default")} tooltipClass="tooltip-top" />}
                    {action.friendlyName}
                </>
            }
            description={action.description}
        >
            <ShortcutEditor keyboardShortcut={action} conflicts={conflicts} />
        </OptionsRow>
    );
}

function ShortcutEditor({ keyboardShortcut: action, conflicts }: { keyboardShortcut: ActionKeyboardShortcut; conflicts?: ShortcutConflicts }) {
    const shortcuts = action.effectiveShortcuts ?? [];
    const electron = isElectron();

    const saveShortcuts = (newShortcuts: string[]) => {
        void options.save(getOptionName(action.actionName), JSON.stringify(newShortcuts));
    };

    const addShortcut = (shortcut: string) => {
        if (!shortcuts.includes(shortcut)) {
            saveShortcuts([ ...shortcuts, shortcut ]);
        }
    };

    const toggleGlobal = (shortcut: string) => {
        const toggled = setGlobalShortcut(shortcut, !isGlobalShortcut(shortcut));
        // De-duplicate in case the toggled form already exists (e.g. both local and global variants).
        saveShortcuts([ ...new Set(shortcuts.map((s) => (s === shortcut ? toggled : s))) ]);
    };

    return (
        <div class="shortcut-editor">
            {shortcuts.map((shortcut) => {
                const global = isGlobalShortcut(shortcut);
                const conflictsWith = conflicts?.get(shortcut);
                return (
                    <span class={`shortcut-chip ${global ? "global" : ""} ${conflictsWith ? "conflict" : ""}`} key={shortcut}>
                        {conflictsWith &&
                            <TooltipIcon
                                icon="bx bx-error-circle"
                                className="shortcut-chip-conflict"
                                tooltip={t("shortcuts.conflict_chip", { actions: conflictsWith.join(", ") })}
                                tooltipClass="tooltip-top"
                            />}
                        {electron
                            ? (
                                <TooltipButton
                                    className={`shortcut-chip-action shortcut-chip-global ${global ? "active" : ""}`}
                                    title={global ? t("shortcuts.make_local") : t("shortcuts.make_global")}
                                    onClick={() => toggleGlobal(shortcut)}
                                >
                                    <span class="bx bx-globe" />
                                </TooltipButton>
                            )
                            : global && <TooltipIcon icon="bx bx-globe" className="shortcut-chip-global-indicator" tooltip={t("shortcuts.global_shortcut")} tooltipClass="tooltip-top" />}
                        <kbd>{stripGlobalPrefix(shortcut)}</kbd>
                        <TooltipButton
                            className="shortcut-chip-action shortcut-chip-remove"
                            title={t("shortcuts.remove_shortcut")}
                            onClick={() => saveShortcuts(shortcuts.filter((s) => s !== shortcut))}
                        >
                            <span class="bx bx-x" />
                        </TooltipButton>
                    </span>
                );
            })}

            {/* Reserve the slot so the add button never shifts when a row's modified state toggles,
                but only mount the revert button when there's actually something to revert. */}
            <span class="shortcut-revert-slot">
                {isShortcutModified(action) &&
                    <ActionButton
                        icon="bx bx-reset"
                        text={t("shortcuts.revert_to_default", { shortcuts: formatDefaultShortcuts(action) })}
                        tooltipClass="tooltip-top"
                        onClick={() => revertShortcut(action)}
                    />}
            </span>
            <ShortcutRecorder onCapture={addShortcut} />
        </div>
    );
}

const RECORDING_TOAST_ID = "shortcut-recorder-recording";

export function ShortcutRecorder({ onCapture }: { onCapture: (shortcut: string) => void }) {
    const [ recording, setRecording ] = useState(false);

    useEffect(() => {
        if (!recording) {
            return;
        }

        toast.showPersistent({
            id: RECORDING_TOAST_ID,
            icon: "bx bxs-keyboard",
            message: t("shortcuts.recording_toast")
        });

        const onKeyDown = (e: KeyboardEvent) => {
            // Swallow the combination so it never reaches the application's own shortcut handlers.
            e.preventDefault();
            e.stopImmediatePropagation();

            if (isRecorderCancelKey(e)) {
                setRecording(false);
                return;
            }

            // Ignore lone modifiers and invalid single-key combinations (keyboardEventToShortcut
            // returns null) so recording continues until a bindable combination is pressed.
            const shortcut = keyboardEventToShortcut(e);
            if (shortcut) {
                onCapture(shortcut);
                setRecording(false);
            }
        };

        // Capture phase on window so we intercept the keystroke ahead of any other listener.
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            toast.closePersistent(RECORDING_TOAST_ID);
        };
    }, [ recording, onCapture ]);

    // Keep the button a fixed-size icon-action in both states so toggling recording never reflows
    // the row; the recording state is conveyed through styling and the tooltip.
    return (
        <ActionButton
            className={`shortcut-recorder ${recording ? "recording" : ""}`}
            icon="bx bx-plus"
            text={recording ? t("shortcuts.press_keys") : t("shortcuts.record_shortcut")}
            titlePosition="top"
            tooltipClass="tooltip-top"
            onClick={() => setRecording((value) => !value)}
            onBlur={() => setRecording(false)}
        />
    );
}

/**
 * Attaches a Bootstrap tooltip to an element on the shortcuts page. Uses the `tooltip-top` popup
 * class so the tooltip renders above the options modal, and a focus trigger on mobile where hover
 * is unavailable.
 */
function useShortcutTooltip(elRef: RefObject<Element>, title: string) {
    useStaticTooltip(elRef, {
        title,
        placement: "top",
        fallbackPlacements: [ "top" ],
        customClass: "tooltip-top",
        trigger: isMobile() ? "focus" : "hover focus",
        animation: false
    });
}

/** Icon button carrying a Bootstrap tooltip instead of a native `title`. */
function TooltipButton({ className, title, onClick, children }: {
    className: string;
    title: string;
    onClick: () => void;
    children?: ComponentChildren;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    useShortcutTooltip(ref, title);
    return (
        <button ref={ref} type="button" class={className} onClick={onClick}>
            {children}
        </button>
    );
}

/**
 * Whether a keystroke should cancel the recorder. Only a bare Escape cancels — Escape held with a
 * modifier (e.g. Ctrl+Escape) is a valid bindable combination and must be recorded, not swallowed.
 */
export function isRecorderCancelKey(e: KeyboardEvent) {
    return e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
}

const GLOBAL_PREFIX = "global:";

function isGlobalShortcut(shortcut: string) {
    return shortcut.startsWith(GLOBAL_PREFIX);
}

function stripGlobalPrefix(shortcut: string) {
    return isGlobalShortcut(shortcut) ? shortcut.substring(GLOBAL_PREFIX.length) : shortcut;
}

export function setGlobalShortcut(shortcut: string, global: boolean) {
    const bare = stripGlobalPrefix(shortcut);
    return global ? `${GLOBAL_PREFIX}${bare}` : bare;
}

const MODIFIER_KEYS = new Set([ "Control", "Alt", "Shift", "Meta" ]);

const NAMED_KEYS: Record<string, string> = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    " ": "Space", Spacebar: "Space"
};

/**
 * Converts a captured {@link KeyboardEvent} into a shortcut string matching the stored format
 * (e.g. `Ctrl+Shift+J`). Returns `null` when the event is not a valid, bindable shortcut, i.e.:
 *  - a lone modifier key (Ctrl/Alt/Shift/Meta), or
 *  - a modifier-less key the matcher would never fire — everything except function keys, Delete
 *    and Enter (see {@link KEYCODES_WITH_NO_MODIFIER}).
 */
export function keyboardEventToShortcut(e: KeyboardEvent): string | null {
    const key = normalizeCapturedKey(e);
    if (!key) {
        return null;
    }

    const modifiers: string[] = [];
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.metaKey) modifiers.push("Meta");

    // Disallow single-key shortcuts that have no modifier, since they would never match at runtime.
    if (modifiers.length === 0 && !KEYCODES_WITH_NO_MODIFIER.has(e.code)) {
        return null;
    }

    return [ ...modifiers, key ].join("+");
}

function normalizeCapturedKey(e: KeyboardEvent): string | null {
    const { code, key } = e;

    if (MODIFIER_KEYS.has(key)) {
        return null;
    }

    // Use the physical code for letters/digits so the result is keyboard-layout independent.
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) {
        return letter[1];
    }
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (digit) {
        return digit[1];
    }

    if (NAMED_KEYS[key]) {
        return NAMED_KEYS[key];
    }

    // Function keys and named keys (Enter, Delete, F5, Home, …) already match the stored format.
    return key.length === 1 ? key.toUpperCase() : key;
}

const PREFIX = "keyboardShortcuts";

export function getOptionName(actionName: string) {
    return `${PREFIX}${actionName.substr(0, 1).toUpperCase()}${actionName.substr(1)}` as OptionNames;
}

export function getActionNameFromOptionName(optionName: string) {
    // `?? ""` guards against `String.at()` returning undefined (which would otherwise coerce to the
    // literal "undefined" when concatenated) for an option name with no action suffix.
    return (optionName.at(PREFIX.length)?.toLowerCase() ?? "") + optionName.substring(PREFIX.length + 1);
}
