import "./LaunchBar.css";

import { useEffect, useState } from "preact/hooks";

import type FNote from "../../entities/fnote.js";
import froca from "../../services/froca.js";

/**
 * The launchers of the desktop launch bar, which `LauncherContainer` is moved into piece by piece.
 * A launcher whose widget has not been moved yet gets a placeholder of the size of a button.
 */
export default function LaunchBar() {
    const launcherNotes = useLauncherNotes();

    return (
        <div id="launcher-container">
            {launcherNotes?.map((launcherNote) => <Launcher key={launcherNote.noteId} launcherNote={launcherNote} />)}
        </div>
    );
}

function Launcher({ launcherNote }: { launcherNote: FNote }) {
    if (launcherNote.getLabelValue("builtinWidget") === "spacer") {
        // `||` and not `??`, since an empty label means the default and 0 is a valid size.
        const baseSize = parseInt(launcherNote.getLabelValue("baseSize") || "40", 10);
        const growthFactor = parseInt(launcherNote.getLabelValue("growthFactor") || "100", 10);

        return (
            <div
                className="spacer"
                data-launcher-id={launcherNote.noteId}
                style={{ flexBasis: `${baseSize}px`, flexGrow: growthFactor, flexShrink: 1000 }}
            />
        );
    }

    return <div className="launcher-button launcher-placeholder" data-launcher-id={launcherNote.noteId} />;
}

function useLauncherNotes() {
    const [ launcherNotes, setLauncherNotes ] = useState<FNote[]>();

    useEffect(() => {
        let cancelled = false;
        void froca.getNote("_lbVisibleLaunchers", true)
            .then((root) => root?.getChildNotes())
            .then((childNotes) => {
                if (!cancelled && childNotes) {
                    setLauncherNotes(childNotes);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return launcherNotes;
}
