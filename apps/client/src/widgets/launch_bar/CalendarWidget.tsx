import { useRef, useState } from "preact/hooks";

import type { DropdownHandle } from "../react/Dropdown";
import { LaunchBarDropdownButton, LauncherNoteProps, useLauncherIconAndTitle } from "./launch_bar_widgets";

/** The calendar launcher: a button whose dropdown, with its dates and day notes, loads when first shown. */
export default function CalendarWidget({ launcherNote }: LauncherNoteProps) {
    const { title, icon } = useLauncherIconAndTitle(launcherNote);
    const dropdownRef = useRef<DropdownHandle>(null);
    const [ shownCount, setShownCount ] = useState(0);
    const [ calendarDropdown, setCalendarDropdown ] = useState<typeof import("./CalendarDropdown")>();

    return (
        <LaunchBarDropdownButton
            panel
            launcherNote={launcherNote}
            icon={icon} title={title}
            onShown={() => {
                setShownCount((count) => count + 1);
                void import("./CalendarDropdown").then(setCalendarDropdown);
            }}
            dropdownRef={dropdownRef}
            autoClose="outside"
        >
            {calendarDropdown && shownCount > 0 && (
                <calendarDropdown.default shownCount={shownCount} dropdownRef={dropdownRef} />
            )}
        </LaunchBarDropdownButton>
    );
}
