import "./InfoBar.css";
import { ComponentChildren, CSSProperties } from "preact";

export type InfoBarParams = {
    type?: "prominent" | "subtle",
    className: string;
    style: CSSProperties
    children: ComponentChildren;
};

export default function InfoBar({ type = "prominent", className, style, children }: InfoBarParams) {
    return <div className={`info-bar ${className} info-bar-${type}`} style={style}>
        {children}
    </div>
}
