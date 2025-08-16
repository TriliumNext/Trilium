import { ComponentChildren, RefObject } from "preact";

interface FormGroupProps {
    labelRef?: RefObject<HTMLLabelElement>;
    label?: string;
    title?: string;
    className?: string;
    children: ComponentChildren;
    description?: string | ComponentChildren;
    disabled?: boolean;
}

export default function FormGroup({ label, title, className, children, description, labelRef, disabled }: FormGroupProps) {
    return (
        <div className={`form-group ${className} ${disabled ? "disabled" : ""}`} title={title}
            style={{ "margin-bottom": "15px" }}>
            <label style={{ width: "100%" }} ref={labelRef}>
                {label && <div style={{ "margin-bottom": "10px" }}>{label}</div> }
                {children}
            </label>

            {description && <small className="form-text">{description}</small>}
        </div>
    );
}