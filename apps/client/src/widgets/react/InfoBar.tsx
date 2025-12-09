import "./InfoBar.css";
import { ComponentChildren, CSSProperties } from "preact";

export type InfoBarParams = {
    type: "prominent" | "subtle",
    className: string;
    style: CSSProperties
    children: ComponentChildren;
};

export default function InfoBar(props: InfoBarParams) {
    return <div className={`info-bar ${props.className} info-bar-${props.type}`} style={props.style}>
        {props?.children}
    </div>
}

InfoBar.defaultProps = {
    type: "prominent"
} as InfoBarParams