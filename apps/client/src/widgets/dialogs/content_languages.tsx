import { useState } from "preact/hooks";

import { useTriliumEvent } from "../react/hooks.jsx";
import { ContentLanguagesModal } from "../ribbon/BasicPropertiesTab.jsx";

/**
 * The content-languages modal, summoned by a command rather than owned by whatever offers it.
 *
 * The ribbon and the status bar each hold their own copy behind a `useState`, which works because
 * both are components sitting next to the switcher they belong to. The AI assistant's Translate
 * submenu is neither: it is a CKEditor menu and a right-click menu, both built imperatively, with
 * nowhere to hang a modal. So the dialog joins the registry in `layout_commons`, where a command is
 * all it takes to raise one.
 */
export default function ContentLanguagesDialog() {
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showContentLanguagesDialog", () => setShown(true));

    return <ContentLanguagesModal modalShown={shown} setModalShown={setShown} />;
}
