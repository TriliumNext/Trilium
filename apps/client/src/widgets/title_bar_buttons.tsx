import { dynamicRequire, isElectron } from "../services/utils";
import { useTriliumOption } from "./react/hooks";
import "./title_bar_buttons.css";
import type { BrowserWindow } from "electron";

interface TitleBarButtonProps {
    className: string;
    icon: string;
    onClick: (context: {
        window: BrowserWindow
    }) => void;
}

export default function TitleBarButtons() {
    const [ nativeTitleBarVisible ] = useTriliumOption("nativeTitleBarVisible");
    const isEnabled = (isElectron() && nativeTitleBarVisible);

    return (
        <div className="title-bar-buttons">
            {isEnabled && (
                <>
                    <TitleBarButton
                        className="minimize-btn"
                        icon="bx bx-minus"
                        onClick={({ window }) => window.minimize()}
                    />

                    <TitleBarButton
                        className="maximize-btn"
                        icon="bx bx-checkbox"
                        onClick={({ window }) => {
                            if (window.isMaximized()) {
                                window.unmaximize();
                            } else {
                                window.maximize();
                            }
                        }}
                    />

                    <TitleBarButton
                        className="close-btn"
                        icon="bx bx-x"
                        onClick={({ window }) => window.close()}
                    />
                </>
            )}
        </div>
    )
}

function TitleBarButton({ className, icon, onClick }: TitleBarButtonProps) {
    // divs act as a hitbox for the buttons, making them clickable on corners
    return (
        <div className={className}>
            <button className={`btn ${icon}`} onClick={() => {
                const remote = dynamicRequire("@electron/remote");
                const focusedWindow = remote.BrowserWindow.getFocusedWindow();
                if (!focusedWindow) return;
                onClick({ window: focusedWindow });
            }} />
        </div>
    );
}
