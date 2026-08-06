import "./EmbeddedNotePane.css";

import { ComponentChildren, RefObject } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../components/app_context";
import Component from "../components/component";
import NoteContext, { openInCurrentNoteContext } from "../components/note_context";
import FNote from "../entities/fnote";
import NoteColorPicker from "../menus/custom-items/NoteColorPicker";
import linkContextMenu from "../menus/link_context_menu";
import { t } from "../services/i18n";
import link from "../services/link";
import ActionButton from "./react/ActionButton";
import Dropdown from "./react/Dropdown";
import { FormListItem } from "./react/FormList";
import { useNoteContext } from "./react/hooks";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

/*
 * A note embedded in a pane of its host view — the geo map's marker pane, the calendar's detail
 * dock: the note-context wiring such a pane needs to hold the real note widgets (TitleRow,
 * PromotedAttributes, NoteDetail), and, in EmbeddedNotePane.css, the layout that fits them into a
 * third of the width they are written for. The pane itself — where it stands, how it opens and
 * closes, what it offers around the note — stays with the view that owns it.
 */

/**
 * A note context of the pane's own, pointed at whichever note the pane stands for — the arrangement
 * the quick editor makes, so that the icon and title widgets work and a rename saves the usual way.
 *
 * One context for the pane rather than one per note: moving between notes is a note switch within a
 * standing pane, not a new pane.
 *
 * The returned component stands between the host view's component and the pane's contents. The
 * context was built here rather than by the tab manager, so it has no parent to raise events
 * through and is given one by hand — the pane's component, not the host's. Pointing a note context
 * at a note announces a note switch, and an unbound `useNoteContext` rebinds to whatever context it
 * hears named (see hooks.tsx). The quick editor gets away with announcing to its parent because it
 * is a dialog at the root; the pane is inside its view, so the collection view around it would
 * rebind to the pane's note and tear the view down. It still hangs off the host's component as a
 * child, so app-wide events travel down into the pane — a component hanging off nothing would never
 * hear that its note was edited elsewhere.
 */
export function useEmbeddedNoteContext(note: FNote | undefined, ntxId: string) {
    const parentComponent = useContext(ParentComponent);
    const [ noteContext ] = useState(() => new NoteContext(ntxId));
    const [ component ] = useState(() => new Component());

    useEffect(() => {
        if (!parentComponent) return;

        parentComponent.child(component);
        return () => parentComponent.removeChild(component);
    }, [ parentComponent, component ]);

    useEffect(() => {
        noteContext.triggerEvent = (name, data) => component.handleEventInChildren(name, data);
    }, [ noteContext, component ]);

    useEffect(() => {
        if (!note) return;

        const notePath = note.getBestNotePathString(appContext.tabManager.getActiveContext()?.hoistedNoteId);
        void noteContext.setNote(notePath, {
            // Selecting a note in the pane is not the kind of navigation that should dismiss an
            // open dialog.
            keepActiveDialog: true,
            viewScope: {
                // A note held read-only only because of its size is editable here, as it is in the
                // quick editor; one the reader has marked read-only stays that way.
                readOnlyTemporarilyDisabled: !note.hasLabel("readOnly"),
                // The pane has a third of a note's width, which is not a toolbar's worth: the
                // editor's own follows the selection instead of standing in a bar (see link.ts).
                floatingToolbar: true
            }
        });
    }, [ noteContext, note?.noteId ]);

    return { noteContext, component };
}

/**
 * Announces that the pane's note context is going, giving whatever is being edited in it the chance
 * to save. Closing a pane announces nothing on its own — the widgets are simply unmounted — so the
 * event a note context is removed under is raised here in its place, which is what the editors are
 * listening for (see the spaced updates in hooks.tsx). The contents must still be mounted when it
 * is raised, or there is nobody left to hear it.
 *
 * Best not waited on: the save is under way by the time the call returns, and a request already in
 * flight does not care that what started it has gone. Waiting would hold the pane open for a round
 * trip to the server every time it was closed with something unsaved in it.
 */
export function announceEmbeddedNoteClosing(component: Component, ntxId: string) {
    return component.handleEventInChildren("beforeNoteContextRemove", { ntxIds: [ ntxId ] });
}

/**
 * What the pane's contents live under: the pane's own component and note context, so that the
 * widgets inside read the embedded note rather than the host's, and answer to the pane's component
 * rather than the host's.
 */
export function EmbeddedNoteScope({ component, noteContext, children }: {
    component: Component;
    noteContext: NoteContext;
    children: ComponentChildren;
}) {
    return (
        <ParentComponent.Provider value={component}>
            <NoteContextContext.Provider value={noteContext}>
                {children}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}

/**
 * Puts the caret in the title with the whole of the stock name selected — how a pane opens on a
 * note its host has just created, whose name is the one thing it still lacks. Rendered inside the
 * pane's {@link EmbeddedNoteScope}, and only while the host says the note is new.
 *
 * A component rather than a call after `setNote`, because only rendering says when there is an
 * input to focus: the title widget grows one as the switch's announcement works through it, over
 * more than one render, and a dispatch fired after any fixed delay is a bet on how many. This
 * hears the announcement the same way the title widget does, so by the time its effect runs, the
 * commit that mounted the input is done. The widget matches the event on the pane's ntxId, as it
 * matches the one note_create raises for a note created anywhere else.
 */
export function SelectTitleOnFirstOpen() {
    const { note, ntxId } = useNoteContext();
    const parentComponent = useContext(ParentComponent);
    // Once per opening: the note being edited re-announces itself (a rename saving, say), and the
    // caret must not jump back to the title mid-thought.
    const done = useRef(false);

    useEffect(() => {
        if (!note || done.current || !parentComponent) return;
        done.current = true;
        void parentComponent.handleEventInChildren("focusAndSelectTitle", { isNewNote: true, ntxId });
    }, [ note?.noteId, parentComponent ]);

    return null;
}

/**
 * Links followed within the pane. One that points at a note standing on the host view is the
 * host's to answer — the pane switches to it, the view following along (the map pans, the
 * calendar turns to its date) — instead of navigating the whole tab away from the view. Every
 * other link keeps meaning what it means anywhere else, as does every way of asking for more than
 * a plain navigation: a modified click wanting a new tab or window, a link saying how it wants to
 * be opened — in a popup, at an attachment, at a bookmark, in a named tab.
 *
 * `onFollowLink` is offered the link's note and answers whether the host took the navigation
 * over; only then is the link stopped. Captured on the pane's own element, so it goes ahead of
 * the document-level handler every link click otherwise lands in (see the delegated listeners in
 * link.ts) — and of the editor's.
 */
export function useFollowLinksWithin(paneRef: RefObject<HTMLElement>, onFollowLink: (noteId: string) => boolean) {
    useEffect(() => {
        const pane = paneRef.current;
        if (!pane) return;

        const onClick = (e: MouseEvent) => {
            // A modified click asks for a new tab or window, neither of which the pane answers.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            const anchor = e.target instanceof Element ? e.target.closest("a") : null;
            const href = anchor?.getAttribute("href") ?? anchor?.getAttribute("data-href");
            if (!href) return;

            // A link that says how it wants to be opened is left to say it; only the plain "go to
            // this note" is the pane's to take, and only for a note the host can go to.
            const { noteId, ntxId, viewScope, openInPopup } = link.parseNavigationStateFromUrl(href);
            if (!noteId || ntxId || openInPopup || viewScope?.viewMode !== "default"
                || viewScope.attachmentId || viewScope.bookmark || !onFollowLink(noteId)) return;

            e.preventDefault();
            e.stopPropagation();
        };

        pane.addEventListener("click", onClick, true);
        return () => pane.removeEventListener("click", onClick, true);
    }, [ paneRef, onFollowLink ]);
}

/**
 * The row of actions at the head of the pane: the ways of opening the note, then whatever the host
 * offers to change about it. Named by tooltips rather than labels, as every other row of actions in
 * a panel is: labels would wrap a handful of buttons onto two lines at this width.
 */
export function EmbeddedNoteActions({ children }: { children: ComponentChildren }) {
    return <div className="tn-embedded-note-actions">{children}</div>;
}

/**
 * The ways of opening the pane's note. One stands out — into the tab the host view is in — and the
 * rest are gathered behind the button beside it: spread across the row they read as unrelated
 * things when they are one thing with several destinations, and the menu they are gathered into is
 * the app's own, so the pane offers exactly what a link offers anywhere else rather than a
 * hand-kept subset of it.
 *
 * The quick editor is in that menu but not in the row: it is what a click on the note's marker or
 * chip used to raise, and the pane took that click over — offering it here would put a modal back
 * over the pane that replaced it.
 */
export function OpenNoteActions({ note }: { note: FNote }) {
    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    // A path rather than an id: a note may hang in several places, and each of these opens a path.
    const notePath = note.getBestNotePathString(hoistedNoteId);

    return (
        <>
            <ActionButton
                icon="bx bx-log-in"
                text={t("embedded_note.open-note")}
                // Handed the event: `openInCurrentNoteContext` reads the target tab off the element
                // clicked, which lands the note in the tab the host view is in.
                onClick={(e) => notePath && openInCurrentNoteContext(e as MouseEvent, notePath)}
                disabled={!notePath}
            />

            {/* A dropdown and not the menu the note's own right-click raises — that one is shown at
                a point and dismissed by the next press on the document, and the press that opened
                it from inside the panel is that press. */}
            <Dropdown
                className="tn-embedded-note-more"
                buttonClassName="bx bx-dots-horizontal-rounded"
                title={t("embedded_note.more-ways-to-open")}
                iconAction
                hideToggleArrow
                noDropdownListStyle
                // The panel clips what overflows it, so a menu nested in the row would be cut off at
                // its edge; and a panel's backdrop filter would flatten the menu's own.
                portalToBody
                disabled={!notePath}
            >
                {OTHER_WAYS_TO_OPEN.map(({ command, icon, title }) => (
                    <FormListItem
                        key={command}
                        icon={icon}
                        onClick={(e) => notePath && linkContextMenu.handleLinkContextMenuItem(
                            command, e as MouseEvent, notePath, {}, hoistedNoteId ?? null)}
                    >
                        {title()}
                    </FormListItem>
                ))}
            </Dropdown>
        </>
    );
}

/**
 * The ways of opening a note other than in the tab one is already in, which the split hides behind
 * its arrow. The same four a link offers anywhere in the app, and each is carried out by the app's
 * own handler — only the naming of them is repeated here.
 *
 * Repeated because `linkContextMenu.getItems` asks for the event that raised it, which a menu drawn
 * before anything is pressed does not have. What it wants the event for is one mobile-only wording,
 * so the loss is a label rather than behaviour. The titles are thunks so they are translated when
 * the menu is drawn rather than when this module loads.
 */
export const OTHER_WAYS_TO_OPEN = [
    { command: "openNoteInNewTab", icon: "bx bx-link-external", title: () => t("link_context_menu.open_note_in_new_tab") },
    // The one worth having beside a collection view most of all: what the view shows stays on show
    // while the note is read beside it.
    { command: "openNoteInNewSplit", icon: "bx bx-dock-right", title: () => t("link_context_menu.open_note_in_new_split") },
    { command: "openNoteInNewWindow", icon: "bx bx-window-open", title: () => t("link_context_menu.open_note_in_new_window") },
    // The quick editor, which is what a click on the note used to raise before the pane took that
    // click over. Kept because the note's own right-click menu offers it and the two should agree —
    // it is a way of opening the note that happens to stand over the pane, not a rival to it.
    { command: "openNoteInPopup", icon: "bx bx-edit", title: () => t("link_context_menu.open_note_in_popup") }
] as const;

/**
 * The pane grown into the quick editor: the same note in the larger surface, taking the pane's
 * place rather than standing over it — opened first and closed after, as the quick editor's own
 * maximize hands over to a tab. Which is what earns it the place in the header that the quick-edit
 * menu entry is denied in the row (see {@link OTHER_WAYS_TO_OPEN}): a maximize replaces the pane
 * instead of putting a modal back over it, the close giving whatever is being edited the chance to
 * save. Stands beside the header's X, and is dressed as its neighbour is (see EmbeddedNotePane.css).
 *
 * A path rather than an id, as the menu passes one, so the two roads into the quick editor agree.
 */
export function MaximizeToQuickEditAction({ note, onClose }: { note: FNote; onClose(): void }) {
    return (
        <ActionButton
            className="tn-embedded-note-maximize"
            icon="bx bx-expand-alt"
            text={t("embedded_note.maximize")}
            onClick={() => {
                const notePath = note.getBestNotePathString(appContext.tabManager.getActiveContext()?.hoistedNoteId);
                appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath || note.noteId });
                onClose();
            }}
        />
    );
}

/**
 * The colour the note's marker, chip or card is drawn in, which the pane already wears in its title
 * but would otherwise have no way of setting — the right-click menu was the only place it could be
 * reached. Named by the host: what the colour dresses is the host's to say (a marker, an event).
 *
 * Sent to the body because a panel may clip what overflows it or carry a backdrop filter, either of
 * which would be enough to cut the menu off or flatten its own frosting (see the Dropdown notes in
 * CLAUDE.md).
 */
export function NoteColorAction({ note, title }: { note: FNote; title: string }) {
    return (
        <Dropdown
            className="tn-embedded-note-color"
            buttonClassName="bx bx-palette"
            title={title}
            iconAction
            hideToggleArrow
            noDropdownListStyle
            portalToBody
        >
            <NoteColorPicker note={note} />
        </Dropdown>
    );
}
