import "./FormToggle.css";
import HelpButton from "./HelpButton";

interface FormToggleProps {
    currentValue: boolean | null;
    onChange(newValue: boolean): void;
    switchOnName: string;
    switchOnTooltip: string;
    switchOffName: string;
    switchOffTooltip: string;
    helpPage?: string;
    disabled?: boolean;
}

export default function FormToggle({ currentValue, helpPage, switchOnName, switchOnTooltip, switchOffName, switchOffTooltip, onChange, disabled }: FormToggleProps) {
    return (
        <div className="switch-widget">
            <span className="switch-name">{ currentValue ? switchOffName : switchOnName }</span>

            <label>
                <div
                    className={`switch-button ${currentValue ? "on" : ""} ${disabled ? "disabled" : ""}`}
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
    )
}