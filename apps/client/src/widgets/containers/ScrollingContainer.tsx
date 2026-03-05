import { ComponentChildren } from "preact";

export default function ScrollingContainer({ children }: { children: ComponentChildren }) {
    return (
        <div className="scrolling-container">
            {children}
        </div>
    );
}
