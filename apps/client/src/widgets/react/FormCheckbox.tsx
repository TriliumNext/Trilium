import { Tooltip } from "bootstrap";
import { useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import { escapeQuotes } from "../../services/utils";
import { ComponentChildren } from "preact";
import { CSSProperties, memo } from "preact/compat";
import { useUniqueName } from "./hooks";

interface FormCheckboxProps {
    id?: string;
    name?: string;
    label: string | ComponentChildren;
    /**
     * If set, the checkbox label will be underlined and dotted, indicating a hint. When hovered, it will show the hint text.
     */
    hint?: string;
    currentValue: boolean;
    disabled?: boolean;
    onChange(newValue: boolean): void;
    containerStyle?: CSSProperties;
}

const FormCheckbox = memo(({ name, id: _id, disabled, label, currentValue, onChange, hint, containerStyle }: FormCheckboxProps) => {
    const id = _id ?? useUniqueName(name);
    const labelRef = useRef<HTMLLabelElement>(null);

    // Fix: Move useEffect outside conditional
    useEffect(() => {
        if (!hint || !labelRef.current) return;
        
        const tooltipInstance = Tooltip.getOrCreateInstance(labelRef.current, {
            html: true,
            template: '<div class="tooltip tooltip-top" role="tooltip"><div class="arrow"></div><div class="tooltip-inner"></div></div>'
        });
        
        return () => tooltipInstance?.dispose();
    }, [hint]); // Proper dependency

    // Memoize style object
    const labelStyle = useMemo(() => 
        hint ? { textDecoration: "underline dotted var(--main-text-color)" } : undefined,
        [hint]
    );
    
    // Memoize onChange handler
    const handleChange = useCallback((e: Event) => {
        onChange((e.target as HTMLInputElement).checked);
    }, [onChange]);
    
    // Memoize title attribute
    const titleText = useMemo(() => hint ? escapeQuotes(hint) : undefined, [hint]);

    return (
        <div className="form-checkbox" style={containerStyle}>
            <label
                className="form-check-label tn-checkbox"
                style={labelStyle}
                title={titleText}
                ref={labelRef}
            >
                <input
                    id={id}
                    className="form-check-input"
                    type="checkbox"
                    name={id}
                    checked={currentValue || false}
                    value="1"
                    disabled={disabled}
                    onChange={handleChange} />
                {label}
            </label>
        </div>
    );
});

export default FormCheckbox;