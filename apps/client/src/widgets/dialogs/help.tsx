import Modal from "../react/Modal.jsx";
import { t } from "../../services/i18n.js";
import { ComponentChildren } from "preact";
import appContext, { CommandNames } from "../../components/app_context.js";
import RawHtml from "../react/RawHtml.jsx";
import { useEffect, useState } from "preact/hooks";
import keyboard_actions from "../../services/keyboard_actions.js";
import { useTriliumEvent } from "../react/hooks.jsx";

export default function HelpDialog() {
    const [ shown, setShown ] = useState(false);
    useTriliumEvent("showCheatsheet", () => setShown(true));

    return (
        <Modal
            title={t("help.title")} className="help-dialog use-tn-links" minWidth="90%" size="lg" scrollable
            customTitleBarButtons={[{title: t("help.editShortcuts"), iconClassName: "bxs-pencil", onClick: editShortcuts}]}
            onHidden={() => setShown(false)}
            show={shown}
        >
            <div className="help-cards row row-cols-md-3 g-3">
                <Card title={t("help.noteNavigation")}>
                    <ul>
                        <FixedKeyboardShortcut keys={["Up", "Down"]} description={t("help.goUpDown")} />
                        <FixedKeyboardShortcut keys={["Left", "Right"]} description={t("help.collapseExpand")} />
                        <KeyboardShortcut commands="backInNoteHistory" description={t("help.goBackForwards")} />
                        <KeyboardShortcut commands="jumpToNote" description={t("help.showJumpToNoteDialog")} />
                        <KeyboardShortcut commands="scrollToActiveNote" description={t("help.scrollToActiveNote")} />
                        <FixedKeyboardShortcut keys={["Backspace"]} description={t("help.jumpToParentNote")} />
                        <KeyboardShortcut commands="collapseTree" description={t("help.collapseWholeTree")} />
                        <KeyboardShortcut commands="collapseSubtree" description={t("help.collapseSubTree")} />
                    </ul>
                </Card>

                <Card title={t("help.tabShortcuts")}>
                    <ul>
                        <FixedKeyboardShortcut keys={["Ctrl+Click", "Ctrl+middle click"]} description={t("help.newTabNoteLink")} />
                        <FixedKeyboardShortcut keys={["Ctrl+Shift+Click", "Shift+middle click"]} description={t("help.newTabWithActivationNoteLink")} />
                    </ul>

                    <h6>{t("help.onlyInDesktop")}</h6>
                    <ul>
                        <KeyboardShortcut commands="openNewTab" description={t("help.openEmptyTab")} />
                        <KeyboardShortcut commands="closeActiveTab" description={t("help.closeActiveTab")} />
                        <KeyboardShortcut commands="activateNextTab" description={t("help.activateNextTab")} />
                        <KeyboardShortcut commands="activatePreviousTab" description={t("help.activatePreviousTab")} />
                    </ul>
                </Card>

                <Card title={t("help.creatingNotes")}>
                    <ul>
                        <KeyboardShortcut commands="createNoteAfter" description={t("help.createNoteAfter")} />
                        <KeyboardShortcut commands="createNoteInto" description={t("help.createNoteInto")} />
                        <KeyboardShortcut commands="editBranchPrefix" description={t("help.editBranchPrefix")} />
                    </ul>
                </Card>

                <Card title={t("help.movingCloningNotes")}>
                    <ul>
                        <KeyboardShortcut commands={["moveNoteUp", "moveNoteDown"]} description={t("help.moveNoteUpDown")} />
                        <KeyboardShortcut commands={["moveNoteUpInHierarchy", "moveNoteDownInHierarchy"]} description={t("help.moveNoteUpHierarchy")} />
                        <KeyboardShortcut commands={["addNoteAboveToSelection", "addNoteBelowToSelection"]} description={t("help.multiSelectNote")} />
                        <KeyboardShortcut commands="selectAllNotesInParent" description={t("help.selectAllNotes")} />
                        <FixedKeyboardShortcut keys={["Shift+Click"]} description={t("help.selectNote")} />
                        <KeyboardShortcut commands="copyNotesToClipboard" description={t("help.copyNotes")} />
                        <KeyboardShortcut commands="cutNotesToClipboard" description={t("help.cutNotes")} />
                        <KeyboardShortcut commands="pasteNotesFromClipboard" description={t("help.pasteNotes")} />
                        <KeyboardShortcut commands="deleteNotes" description={t("help.deleteNotes")} />
                    </ul>
                </Card>

                <Card title={t("help.editingNotes")}>
                    <ul>
                        <KeyboardShortcut commands="editNoteTitle" description={t("help.editNoteTitle")} />
                        <FixedKeyboardShortcut keys={["Ctrl+K"]} description={t("help.createEditLink")} />
                        <KeyboardShortcut commands="addLinkToText" description={t("help.createInternalLink")} />
                        <KeyboardShortcut commands="followLinkUnderCursor" description={t("help.followLink")} />
                        <KeyboardShortcut commands="insertDateTimeToText" description={t("help.insertDateTime")} />
                        <KeyboardShortcut commands="scrollToActiveNote" description={t("help.jumpToTreePane")} />
                    </ul>
                </Card>

                <Card title={t("help.markdownAutoformat")}>
                    <ul>
                        <li><RawHtml html={t("help.headings")} /></li>
                        <li><RawHtml html={t("help.bulletList")} /></li>
                        <li><RawHtml html={t("help.numberedList")} /></li>
                        <li><RawHtml html={t("help.blockQuote")} /></li>
                    </ul>
                </Card>

                <Card title={t("help.troubleshooting")}>
                    <ul>
                        <KeyboardShortcut commands="reloadFrontendApp" description={t("help.reloadFrontend")} />
                        <KeyboardShortcut commands="openDevTools" description={t("help.showDevTools")} />
                        <KeyboardShortcut commands="showSQLConsole" description={t("help.showSQLConsole")} />
                    </ul>
                </Card>

                <Card title={t("help.other")}>
                    <ul>
                        <KeyboardShortcut commands="quickSearch" description={t("help.quickSearch")} />
                        <KeyboardShortcut commands="findInText" description={t("help.inPageSearch")} />
                    </ul>
                </Card>
            </div>
        </Modal>
    );
}

function KeyboardShortcut({ commands, description }: { commands: CommandNames | CommandNames[], description: string }) {
    const [ shortcuts, setShortcuts ] = useState<string[]>([]);
    
    useEffect(() => {
        (async () => {
            const shortcuts: string[] = [];
            for (const command of Array.isArray(commands) ? commands : [commands]) {
                const action = await keyboard_actions.getAction(command);
                if (action) {
                    shortcuts.push(...(action.effectiveShortcuts ?? []));
                }
            }

            if (shortcuts.length === 0) {
                shortcuts.push(t("help.notSet"));
            }

            setShortcuts(shortcuts);
        })();
    }, [commands]);

    return FixedKeyboardShortcut({
        keys: shortcuts,
        description
    });
}

function FixedKeyboardShortcut({ keys, description }: { keys?: string[], description: string }) {
    return (
        <li>
            {keys && keys.map((key, index) =>
                <>
                    <kbd key={index}>{key}</kbd>
                    {index < keys.length - 1 ? ", " : "" }
                </>
            )} - <RawHtml html={description} />
        </li>
    );
}

function Card({ title, children }: { title: string, children: ComponentChildren }) {
    return (
        <div className="card">
            <div className="card-body">
                <h5 className="card-title">{title}</h5>

                <p className="card-text">
                    {children}
                </p>
            </div>
        </div>
    )
}

function editShortcuts() {
    appContext.tabManager.openContextWithNote("_optionsShortcuts", { activate: true });
}