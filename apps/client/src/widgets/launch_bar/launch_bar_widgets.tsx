import clsx from "clsx";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import FNote from "../../entities/fnote";
import utils from "../../services/utils";
import ActionButton, { ActionButtonProps } from "../react/ActionButton";
import Dropdown, { DropdownProps } from "../react/Dropdown";
import { useNoteLabel, useNoteProperty } from "../react/hooks";
import Icon from "../react/Icon";

const cachedIsMobile = utils.isMobile();

export const LaunchBarContext = createContext<{
    isHorizontalLayout: boolean;
}>({
    isHorizontalLayout: false
});

export interface LauncherNoteProps {
    /** The corresponding {@link FNote} of type {@code launcher} in the hidden subtree of this launcher. Generally this launcher note holds information about the launcher via labels and relations, but also the title and the icon of the launcher. Not to be confused with the target note, which is specific to some launchers. */
    launcherNote: FNote;
}

export function LaunchBarActionButton({ className, ...props }: Omit<ActionButtonProps, "noIconActionClass" | "titlePosition">) {
    const { isHorizontalLayout } = useContext(LaunchBarContext);

    return (
        <ActionButton
            className={clsx("button-widget launcher-button", className)}
            noIconActionClass
            titlePosition={getTitlePosition(isHorizontalLayout)}
            {...props}
        />
    );
}

export function LaunchBarDropdownButton({ children, icon, dropdownOptions, ...props }: Pick<DropdownProps, "title" | "children" | "onShown" | "dropdownOptions" | "dropdownRef"> & { icon: string }) {
    const { isHorizontalLayout } = useContext(LaunchBarContext);
    const titlePosition = getTitlePosition(isHorizontalLayout);

    return (
        <Dropdown
            className="right-dropdown-widget"
            buttonClassName="right-dropdown-button launcher-button"
            hideToggleArrow
            text={<Icon icon={icon} />}
            titlePosition={titlePosition}
            titleOptions={{ animation: false }}
            dropdownOptions={{
                ...dropdownOptions,
                popperConfig: {
                    placement: titlePosition
                }
            }}
            mobileBackdrop
            {...props}
        >{children}</Dropdown>
    );
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

function getTitlePosition(isHorizontalLayout: boolean) {
    if (cachedIsMobile) {
        return "top";
    }
    return isHorizontalLayout ? "bottom" : "right";
}
