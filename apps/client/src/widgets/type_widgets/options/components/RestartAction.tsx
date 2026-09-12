import "./RestartAction.css";

import { restartDesktopApp } from "../../../../services/utils";
import Button from "../../../react/Button";

interface RestartActionProps {
    /** How the page asks for it — one states what a restart is for, another that it is needed now. */
    text: string;
    /** Icon in {@link Button} format (e.g. `bx-refresh`, without the leading `bx `). */
    icon?: string;
}

/**
 * The way to start the app again, offered by a page whose settings only take effect once it has.
 *
 * No card of its own: it acts rather than holds anything, and a framed row of one button reads as a
 * setting that has lost its label. It keeps the cards' width all the same, so it ends where their
 * controls do rather than at the far edge of the page.
 */
export default function RestartAction({ text, icon }: RestartActionProps) {
    return (
        <div className="restart-action">
            <Button
                name="restart-app-button"
                text={text}
                icon={icon}
                size="micro"
                onClick={restartDesktopApp}
            />
        </div>
    );
}
