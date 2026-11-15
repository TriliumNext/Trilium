import clsx from "clsx";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import FNote from "../../entities/fnote";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import utils from "../../services/utils";
import ActionButton, { ActionButtonProps } from "../react/ActionButton";
import Dropdown, { DropdownPanel, DropdownProps } from "../react/Dropdown";
import { useNoteLabel, useNoteProperty } from "../react/hooks";
import Icon from "../react/Icon";

const cachedIsMobile = utils.isMobile();

// Hoisted so the reference is stable across renders — an inline object would change identity
// every render and defeat Dropdown's tooltip-config memoization, recreating the tooltip each time.
const DROPDOWN_TITLE_OPTIONS = { animation: false } as const;

export const LaunchBarContext = createContext<{
    isHorizontalLayout: boolean;
    /** Whether the buttons show their titles under their icons, as in the mobile navigation rail. */
    showLabels?: boolean;
    /** Called as a launcher's popup opens: the navigation rail hides the note tree, whose place it takes. */
    onPopupShown?: () => void;
}>({
    isHorizontalLayout: false
});

export interface LauncherNoteProps {
    /** The corresponding {@link FNote} of type {@code launcher} in the hidden subtree of this launcher. Generally this launcher note holds information about the launcher via labels and relations, but also the title and the icon of the launcher. Not to be confused with the target note, which is specific to some launchers. */
    launcherNote: FNote;
}

/**
 * Builds the default right-click handler that shows the launch-bar icon context menu (with the
 * "Remove from launch bar" entry). Used by widgets that render a raw element rather than going
 * through {@link LaunchBarActionButton} / {@link LaunchBarDropdownButton}. `parentNoteId` is the
 * launch bar section that shows the button, see `ShowLauncherContextMenuOptions`.
 */
export function launcherContextMenuHandler(
    launcherNote: FNote | null | undefined,
    parentNoteId?: string
) {
    if (!launcherNote) return undefined;
    return (e: MouseEvent) => showLauncherContextMenu(launcherNote, e, { parentNoteId });
}

export function LaunchBarActionButton({ className, launcherNote, onContextMenu, ...props }: Omit<ActionButtonProps, "noIconActionClass" | "titlePosition" | "children"> & { launcherNote?: FNote }) {
    const { isHorizontalLayout } = useContext(LaunchBarContext);

    return (
        <ActionButton
            className={clsx("button-widget launcher-button", className)}
            noIconActionClass
            titlePosition={getTitlePosition(isHorizontalLayout)}
            onContextMenu={onContextMenu ?? launcherContextMenuHandler(launcherNote)}
            {...props}
        >
            <LauncherLabel text={props.text} />
        </ActionButton>
    );
}

export function LaunchBarDropdownButton({
    children, icon, launcherNote, parentNoteId, buttonProps, panel, onShown, ...props
}: Pick<
    DropdownProps, "title" | "children" | "onShown" | "autoClose" | "dropdownRef" | "buttonProps"
        | "filterable" | "keepOrder"
> & {
    icon: string,
    launcherNote?: FNote,
    /** The launch bar section that shows the button. See `ShowLauncherContextMenuOptions`. */
    parentNoteId?: string,
    /** Opens a {@link DropdownPanel} rather than a menu, for content other than `FormList` rows. */
    panel?: boolean
}) {
    const { isHorizontalLayout, onPopupShown } = useContext(LaunchBarContext);
    const titlePosition = getTitlePosition(isHorizontalLayout);

    const resolvedButtonProps = launcherNote && !buttonProps?.onContextMenu
        ? { ...buttonProps, onContextMenu: launcherContextMenuHandler(launcherNote, parentNoteId) }
        : buttonProps;
    const Component = panel ? DropdownPanel : Dropdown;

    return (
        <Component
            className="right-dropdown-widget"
            buttonClassName="right-dropdown-button launcher-button"
            hideToggleArrow
            text={<><Icon icon={icon} /><LauncherLabel text={props.title} /></>}
            titlePosition={titlePosition}
            titleOptions={DROPDOWN_TITLE_OPTIONS}
            placement={titlePosition}
            mobileBackdrop
            buttonProps={resolvedButtonProps}
            onShown={onPopupShown || onShown ? () => {
                onPopupShown?.();
                onShown?.();
            } : undefined}
            {...props}
        >{children}</Component>
    );
}

/** A launcher's title under its icon, shown only where the launch bar asks for labels (see {@link LaunchBarContext}). */
export function LauncherLabel({ text }: { text: string | undefined }) {
    const { showLabels } = useContext(LaunchBarContext);
    if (!showLabels || !text) return null;
    return <span className="launcher-button-label">{text}</span>;
}

export function useLauncherIconAndTitle(note: FNote) {
    const title = useNoteProperty(note, "title");

    // React to changes.
    useNoteLabel(note, "iconClass");
    useNoteLabel(note, "workspaceIconClass");

    return {
        icon: note.getIcon(),
        title: title ?? ""
    };
}

/** The side of a launcher its tooltips and popups open on. */
export function useLaunchBarTitlePosition() {
    const { isHorizontalLayout } = useContext(LaunchBarContext);
    return getTitlePosition(isHorizontalLayout);
}

function getTitlePosition(isHorizontalLayout: boolean) {
    if (cachedIsMobile) {
        return isHorizontalLayout ? "top" : "right";
    }
    return isHorizontalLayout ? "bottom" : "right";
}
