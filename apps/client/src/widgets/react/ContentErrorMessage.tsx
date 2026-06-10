import "./ContentErrorMessage.css";

interface ContentErrorMessageProps {
    /** The message to display. */
    message: string;
}

/**
 * Centered error message overlaid on a content area (e.g. when a note's content fails to load). Expects
 * a positioned ancestor, since it fills it via absolute positioning.
 */
export default function ContentErrorMessage({ message }: ContentErrorMessageProps) {
    return (
        <div className="content-error-message">
            <div>{message}</div>
        </div>
    );
}
