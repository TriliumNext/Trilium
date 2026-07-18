import "./MaskedIcon.css";

interface MaskedIconProps {
    /** URL of an SVG (e.g. an imported `*.svg?url`) rendered monochrome via a CSS mask. */
    url: string;
    className?: string;
}

/** A monochrome icon rendered from an SVG URL via a CSS mask, tinted with `currentColor`. */
export default function MaskedIcon({ url, className }: MaskedIconProps) {
    return <span className={`masked-icon ${className ?? ""}`} style={{ "--masked-icon-url": `url("${url}")` }} />;
}
