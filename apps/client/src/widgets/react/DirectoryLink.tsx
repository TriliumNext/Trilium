import openService from "../../services/open.js";
import { isElectron } from "../../services/utils.js";

/**
 * A filesystem location, opened in the OS file manager on click. Only the desktop application can
 * open anything, so everywhere else the path is shown as plain (selectable) text.
 */
export default function DirectoryLink({ directory }: { directory: string }) {
    if (isElectron()) {
        const onClick = (e: MouseEvent) => {
            e.preventDefault();
            openService.openDirectory(directory);
        };

        return <a className="tn-link selectable-text" href="#" onClick={onClick}>{directory}</a>;
    }
    return <span className="selectable-text">{directory}</span>;
}
