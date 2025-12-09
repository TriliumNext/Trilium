import appContext, { CommandNames } from "../../components/app_context";
import contextMenu from "../../menus/context_menu";
import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";

interface SpacerWidgetProps {
    baseSize?: number;
    growthFactor?: number;
}

export default function SpacerWidget({ baseSize, growthFactor }: SpacerWidgetProps) {
    return (
        <div
            className="spacer"
            style={{
                flexBasis: baseSize ?? 0,
                flexGrow: growthFactor ?? 1000,
                flexShrink: 1000
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                contextMenu.show<CommandNames>({
                    x: e.pageX,
                    y: e.pageY,
                    items: [{ title: t("spacer.configure_launchbar"), command: "showLaunchBarSubtree", uiIcon: "bx " + (isMobile() ? "bx-mobile" : "bx-sidebar") }],
                    selectMenuItemHandler: ({ command }) => {
                        if (command) {
                            appContext.triggerCommand(command);
                        }
                    }
                });
            }}
        />
    )
}
