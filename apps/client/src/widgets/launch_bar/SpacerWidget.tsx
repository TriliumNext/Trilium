import FNote from "../../entities/fnote";
import { launcherContextMenuHandler } from "./launch_bar_widgets";

interface SpacerWidgetProps {
    launcherNote?: FNote;
    baseSize?: number;
    growthFactor?: number;
}

export default function SpacerWidget({ launcherNote, baseSize, growthFactor }: SpacerWidgetProps) {
    return (
        <div
            className="spacer"
            style={{
                flexBasis: baseSize ?? 0,
                flexGrow: growthFactor ?? 1000,
                flexShrink: 1000
            }}
            onContextMenu={launcherContextMenuHandler(launcherNote)}
        />
    )
}
