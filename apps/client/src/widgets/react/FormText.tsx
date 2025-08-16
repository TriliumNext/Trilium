import { ComponentChildren } from "preact";

export default function FormText({ children }: { children: ComponentChildren }) {
    return <p className="form-text use-tn-links">{children}</p>
}