import $ from "jquery";
import type { ComponentChildren } from "preact";
import { vi } from "vitest";

export interface AddLinkDialogTestState {
    triliumEventHandlers: Map<string, (payload: any) => void>;
    latestModalPropsRef: { current: any };
    latestNoteAutocompletePropsRef: { current: any };
    addLinkSpy: ReturnType<typeof vi.fn>;
    logErrorSpy: ReturnType<typeof vi.fn>;
    showRecentNotesSpy: ReturnType<typeof vi.fn>;
    setTextSpy: ReturnType<typeof vi.fn>;
}

export function createAddLinkDialogTestState(): AddLinkDialogTestState {
    return {
        triliumEventHandlers: new Map<string, (payload: any) => void>(),
        latestModalPropsRef: { current: null as any },
        latestNoteAutocompletePropsRef: { current: null as any },
        addLinkSpy: vi.fn(() => Promise.resolve()),
        logErrorSpy: vi.fn(),
        showRecentNotesSpy: vi.fn(),
        setTextSpy: vi.fn()
    };
}

export function setupAddLinkDialogMocks(state: AddLinkDialogTestState) {
    vi.doMock("../../services/i18n", () => ({
        t: (key: string) => key
    }));

    vi.doMock("../../services/tree", () => ({
        default: {
            getNoteIdFromUrl: (notePath: string) => notePath.split("/").at(-1),
            getNoteTitle: vi.fn(async () => "Target note")
        }
    }));

    vi.doMock("../../services/ws", () => ({
        default: {
            subscribeToMessages: vi.fn(),
            logError: state.logErrorSpy
        },
        logError: state.logErrorSpy
    }));

    vi.doMock("../../services/froca", () => ({
        default: {
            getNote: vi.fn(async () => ({
                getLabels: vi.fn(() => [])
            }))
        }
    }));

    vi.doMock("../../services/note_autocomplete", () => ({
        __esModule: true,
        default: {
            showRecentNotes: state.showRecentNotesSpy,
            setText: state.setTextSpy
        }
    }));

    vi.doMock("../react/react_utils", () => ({
        refToJQuerySelector: (ref: { current: HTMLInputElement | null }) => ref.current ? $(ref.current) : $()
    }));

    vi.doMock("../react/hooks", () => ({
        useTriliumEvent: (name: string, handler: (payload: any) => void) => {
            state.triliumEventHandlers.set(name, handler);
        }
    }));

    vi.doMock("../react/Modal", () => ({
        default: (props: any) => {
            state.latestModalPropsRef.current = props;

            if (!props.show) {
                return null;
            }

            return (
                <form onSubmit={(e) => {
                    e.preventDefault();
                    props.onSubmit?.();
                }}>
                    {props.children}
                    {props.footer}
                </form>
            );
        }
    }));

    vi.doMock("../react/FormGroup", () => ({
        default: ({ children }: { children: ComponentChildren }) => <div>{children}</div>
    }));

    vi.doMock("../react/Button", () => ({
        default: ({ text }: { text: string }) => <button type="submit">{text}</button>
    }));

    vi.doMock("../react/FormRadioGroup", () => ({
        default: () => null
    }));

    vi.doMock("../react/NoteAutocomplete", () => ({
        default: (props: any) => {
            state.latestNoteAutocompletePropsRef.current = props;
            return <input ref={props.inputRef} />;
        }
    }));
}
