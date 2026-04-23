import appContext, { CommandNames } from "../../components/app_context";
import FNote from "../../entities/fnote";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";

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
            onContextMenu={launcherNote ? (e) => showLauncherContextMenu<CommandNames>(launcherNote, e, {
                extraItems: [{
                    title: t("spacer.configure_launchbar"),
                    command: "showLaunchBarSubtree",
                    uiIcon: "bx " + (isMobile() ? "bx-mobile" : "bx-sidebar")
                }],
                onCommand: (command) => {
                    if (command) appContext.triggerCommand(command);
                }
            }) : undefined}
        />
    )
}
