import { MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";

import Icon from "../../react/Icon";
import { useExcalidrawTranslation } from "./CanvasEmbedTools";

/** The name of Excalidraw's default sidebar, whose first tab is the library. */
export const LIBRARY_SIDEBAR = "default";

interface CanvasDrawingMenuProps {
    apiRef: RefObject<ExcalidrawImperativeAPI>;
    isEditable: boolean;
}

/** The main menu of Excalidraw in a canvas drawing. Renders inside `<Excalidraw>`. */
export default function CanvasDrawingMenu({ apiRef, isEditable }: CanvasDrawingMenuProps) {
    const { t } = useExcalidrawTranslation();

    return (
        <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.SearchMenu />
            {isEditable && (
                <MainMenu.Item
                    icon={<Icon icon="bx bx-library" />}
                    onSelect={() => apiRef.current?.toggleSidebar({ name: LIBRARY_SIDEBAR })}
                >
                    {t("toolBar.library")}
                </MainMenu.Item>
            )}
            <MainMenu.DefaultItems.Help />
        </MainMenu>
    );
}
