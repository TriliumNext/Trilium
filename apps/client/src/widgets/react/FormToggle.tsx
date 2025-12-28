import clsx from "clsx";
import "./FormToggle.css";
import HelpButton from "./HelpButton";
import { useEffect, useState } from "preact/hooks";
import { ComponentChildren } from "preact";

interface FormToggleProps {
    currentValue: boolean | null;
    onChange(newValue: boolean): void;
    switchOnName: string;
    switchOnTooltip?: string;
    switchOffName: string;
    switchOffTooltip?: string;
    helpPage?: string;
    disabled?: boolean;
    afterName?: ComponentChildren;
}

export default function FormToggle({ currentValue, helpPage, switchOnName, switchOnTooltip, switchOffName, switchOffTooltip, onChange, disabled, afterName }: FormToggleProps) {
    const [ disableTransition, setDisableTransition ] = useState(true);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDisableTransition(false);
        }, 100);
        return () => clearTimeout(timeout);
    }, []);

    return (
        <div className="switch-widget">
            <span className="switch-name">{ currentValue ? switchOffName : switchOnName }</span>
            { afterName }

            <label>
                <div
                    className={clsx("switch-button", { "on": currentValue, disabled, "disable-transitions": disableTransition })}
                    title={currentValue ? switchOffTooltip : switchOnTooltip }
                >
                    <input
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
