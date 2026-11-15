import { useRef, useState } from "preact/hooks";

import type { DropdownHandle } from "../react/Dropdown";
import { preloadLazyModule } from "../react/LazyComponent";
import { LaunchBarDropdownButton, LauncherNoteProps, useLauncherIconAndTitle } from "./launch_bar_widgets";

const loadDropdown = () => import("./CalendarDropdown");
const preloadDropdown = () => preloadLazyModule(loadDropdown);

/**
 * The calendar launcher: a button whose dropdown, with its dates and day notes, loads when first
 * shown. Pointing at the button or focusing it starts the load, and the dropdown opens once it is
 * done.
 */
export default function CalendarWidget({ launcherNote }: LauncherNoteProps) {
    const { title, icon } = useLauncherIconAndTitle(launcherNote);
    const dropdownRef = useRef<DropdownHandle>(null);
    const [ shownCount, setShownCount ] = useState(0);
    const [ calendarDropdown, setCalendarDropdown ] = useState<Awaited<ReturnType<typeof loadDropdown>>>();

    return (
        <LaunchBarDropdownButton
            panel
            launcherNote={launcherNote}
            icon={icon} title={title}
            buttonProps={{ onPointerEnter: preloadDropdown, onPointerDown: preloadDropdown, onFocus: preloadDropdown }}
            onShown={() => {
                setShownCount((count) => count + 1);
                void loadDropdown().then(setCalendarDropdown);
            }}
            ready={!!calendarDropdown}
            dropdownRef={dropdownRef}
            autoClose="outside"
        >
            {calendarDropdown && shownCount > 0 && (
                <calendarDropdown.default shownCount={shownCount} dropdownRef={dropdownRef} />
            )}
        </LaunchBarDropdownButton>
    );
}
