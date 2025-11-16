import { t } from "i18next";
import "./FloatingButtons.css";
import { useNoteContext, useNoteLabel, useNoteLabelBoolean, useTriliumEvent } from "./react/hooks";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { ParentComponent } from "./react/react_utils";
import { EventData, EventNames } from "../components/app_context";
import { type FloatingButtonsList, type FloatingButtonContext } from "./FloatingButtonsDefinitions";
import ActionButton from "./react/ActionButton";
import { ViewTypeOptions } from "./collections/interface";

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
    const [ top, setTop ] = useState(0);
    const { note, noteContext } = useNoteContext();
    const parentComponent = useContext(ParentComponent);
    const [ viewType ] = useNoteLabel(note, "viewType");
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const context = useMemo<FloatingButtonContext | null>(() => {
        if (!note || !noteContext || !parentComponent) return null;

        return {
            note,
            noteContext,
            parentComponent,
            isDefaultViewMode: noteContext.viewScope?.viewMode === "default",
            viewType: viewType as ViewTypeOptions,
            isReadOnly,
            triggerEvent<T extends EventNames>(name: T, data?: Omit<EventData<T>, "ntxId">) {
                parentComponent.triggerEvent(name, {
                    ntxId: noteContext.ntxId,
                    ...data
                } as EventData<T>);
            }
        };
    }, [ note, noteContext, parentComponent, viewType, isReadOnly ]);

    // Manage the user-adjustable visibility of the floating buttons.
    const [ visible, setVisible ] = useState(true);
    useEffect(() => setVisible(true), [ note ]);

    useTriliumEvent("contentSafeMarginChanged", (e) => {
        if (e.noteContext === noteContext) {
            setTop(e.top);
        }
    });

    return (
        <div className="floating-buttons no-print" style={{top}}>
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