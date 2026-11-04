import "./LoadingSpinner.css";

export default function LoadingSpinner() {
    return <span className="bx bx-loader bx-spin" />
}

/**
 * A spinner that tells that the value of a field is loading. Goes inside an `.input-group`, after
 * the field, in the place of an action button such as `PasteButton`. `label` names what is loading.
 */
export function InputGroupSpinner({ label }: { label: string }) {
    return (
        <span className="input-group-text tn-input-group-spinner" role="status" title={label}
            aria-label={label}>
            <LoadingSpinner />
        </span>
    );
}
