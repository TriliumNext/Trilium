import clsx from "clsx";
import "./FormToggle.css";
import HelpButton from "./HelpButton";
import { useEffect, useState } from "preact/hooks";
import { ComponentChildren } from "preact";

interface FormToggleProps {
    currentValue: boolean | null;
    onChange(newValue: boolean): void;
    /** Label shown when toggle is off. If omitted along with switchOffName, no label is shown. */
    switchOnName?: string;
    switchOnTooltip?: string;
    /** Label shown when toggle is on. If omitted along with switchOnName, no label is shown. */
    switchOffName?: string;
    switchOffTooltip?: string;
    helpPage?: string;
    disabled?: boolean;
    afterName?: ComponentChildren;
    /** ID for the input element, useful for accessibility with external labels */
    id?: string;
}

export default function FormToggle({ currentValue, helpPage, switchOnName, switchOnTooltip, switchOffName, switchOffTooltip, onChange, disabled, afterName, id }: FormToggleProps) {
    const [ disableTransition, setDisableTransition ] = useState(true);
    const hasLabel = switchOnName || switchOffName;

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDisableTransition(false);
        }, 100);
        return () => clearTimeout(timeout);
    }, []);

    return (
        <div className="switch-widget">
            {hasLabel && <span className="switch-name">{ currentValue ? switchOffName : switchOnName }</span>}
            { afterName }

            <label>
                <div
                    className={clsx("switch-button", { "on": currentValue, disabled, "disable-transitions": disableTransition })}
                    title={currentValue ? switchOffTooltip : switchOnTooltip }
                >
                    <input
                        id={id}
                        className="switch-toggle"
                        type="checkbox"
                        checked={currentValue === true}
                        onInput={(e) => {
                            onChange(!currentValue);
                            e.preventDefault();
                        }}
                        disabled={disabled}
                    />
                </div>
            </label>

            { helpPage && <HelpButton className="switch-help-button" helpPage={helpPage} />}
        </div>
    );
}
