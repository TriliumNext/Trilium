import { isElectron } from "../services/utils";
import { useTriliumOption } from "./react/hooks";
import "./title_bar_buttons.css";

interface TitleBarButtonProps {
    className: string;
    icon: string;
    onClick: () => void;
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
                        onClick={() => window.electronApi?.window.minimizeWindow()}
                    />

                    <TitleBarButton
                        className="maximize-btn"
                        icon="bx bx-checkbox"
                        onClick={() => {
                            const api = window.electronApi?.window;
                            if (!api) return;
                            if (api.isMaximized()) {
                                api.unmaximizeWindow();
                            } else {
                                api.maximizeWindow();
                            }
                        }}
                    />

                    <TitleBarButton
                        className="close-btn"
                        icon="bx bx-x"
                        onClick={() => window.electronApi?.window.closeWindow()}
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
            <button className={`btn ${icon}`} onClick={onClick} />
        </div>
    );
}
