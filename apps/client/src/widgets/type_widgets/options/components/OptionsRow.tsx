import { ComponentChildren } from "preact";
import "./OptionsRow.css";

interface OptionsRowProps {
    label?: string;
    children: ComponentChildren;
    centered?: boolean;
}

export default function OptionsRow({ label, children, centered }: OptionsRowProps) {
    return (
        <div className={`option-row ${centered ? "centered" : ""}`}>
            {label && <label>{label}</label>}
            {children}
        </div>
    );
}