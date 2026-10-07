import { t } from "i18next";
import "./FloatingButtons.css";
import { useNoteContext } from "./react/hooks";
import { useEffect, useMemo, useState } from "preact/hooks";
import { type FloatingButtonsList, type FloatingButtonContext } from "./FloatingButtonsDefinitions";
import ActionButton from "./react/ActionButton";

interface FloatingButtonsProps {
    items: FloatingButtonsList;
}

/*
 * Note:
 *
 * For floating button widgets that require content to overflow, the has-overflow CSS class should
 * be applied to the root element of the widget. Additionally, this root element may need to
 * properly handle rounded corners, as defined by the --border-radius CSS variable.
 */
export default function FloatingButtons({ items }: FloatingButtonsProps) {
    const { note, noteContext } = useNoteContext();
    const context = useMemo<FloatingButtonContext | null>(() => {
        if (!note || !noteContext) return null;

        return {
            note,
            isDefaultViewMode: noteContext.viewScope?.viewMode === "default"
        };
    }, [ note, noteContext ]);

    // Manage the user-adjustable visibility of the floating buttons.
    const [ visible, setVisible ] = useState(true);
    useEffect(() => setVisible(true), [ note ]);

    return (
        <div className="floating-buttons no-print">
            <div className={`floating-buttons-children ${!visible ? "temporarily-hidden" : ""}`}>
                {context && items.map((Component) => (
                    <Component {...context} />
                ))}

                {visible && <CloseFloatingButton setVisible={setVisible} />}
            </div>

            {!visible && <ShowFloatingButton setVisible={setVisible} /> }
        </div>
    )
}

/**
 * Show button that displays floating button after click on close button
 */
function ShowFloatingButton({ setVisible }: { setVisible(visible: boolean): void }) {
    return (
        <div className="show-floating-buttons">
            <ActionButton
                className="show-floating-buttons-button"
                icon="bx bx-chevrons-left"
                text={t("show_floating_buttons_button.button_title")}
                onClick={() => setVisible(true)}
                noIconActionClass
            />
        </div>
    );
}

function CloseFloatingButton({ setVisible }: { setVisible(visible: boolean): void }) {
    return (
        <div className="close-floating-buttons">
            <ActionButton
                className="close-floating-buttons-button"
                icon="bx bx-chevrons-right"
                text={t("hide_floating_buttons_button.button_title")}
                onClick={() => setVisible(false)}                
                noIconActionClass
            />
        </div>
    );
}