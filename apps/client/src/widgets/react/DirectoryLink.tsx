import openService from "../../services/open.js";
import { isElectron } from "../../services/utils.js";

/**
 * A filesystem location, handed to the OS file manager on click. Only the desktop application can
 * open anything, so everywhere else the path is shown as plain (selectable) text.
 */
function ShellLink({ path, onOpen }: { path: string; onOpen: () => void }) {
    if (!isElectron()) {
        return <span className="selectable-text">{path}</span>;
    }

    const onClick = (e: MouseEvent) => {
        e.preventDefault();
        onOpen();
    };

    return <a className="tn-link selectable-text" href="#" onClick={onClick}>{path}</a>;
}

/** A directory, opened in the file manager. */
export default function DirectoryLink({ directory }: { directory: string }) {
    return <ShellLink path={directory} onOpen={() => openService.openDirectory(directory)} />;
}

/**
 * A file, revealed in the file manager: the folder holding it opens with the file itself selected.
 * For a file the user is meant to find rather than to open, the database being the one Trilium
 * points at — opening that would hand it to whatever program claims the extension.
 */
export function FileLink({ filePath }: { filePath: string }) {
    return <ShellLink path={filePath} onOpen={() => openService.revealFile(filePath)} />;
}
