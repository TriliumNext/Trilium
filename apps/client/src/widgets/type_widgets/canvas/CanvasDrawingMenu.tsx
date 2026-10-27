import { MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";

import Icon from "../../react/Icon";
import { DEFAULT_SIDEBAR, useExcalidrawTranslation } from "./CanvasEmbedTools";

interface CanvasDrawingMenuProps {
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
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
                    onSelect={() => apiRef.current?.toggleSidebar({ name: DEFAULT_SIDEBAR })}
                >
                    {t("toolBar.library")}
                </MainMenu.Item>
            )}
            <MainMenu.DefaultItems.Help />
        </MainMenu>
    );
}

export function CanvasNoteMenu() {
    return (
        <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
    );
}
