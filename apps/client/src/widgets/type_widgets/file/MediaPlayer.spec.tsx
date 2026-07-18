import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import Component from "../../../components/component";
import { collectShortcutHints } from "../../../services/shortcut_hints";
import { ParentComponent } from "../../react/react_utils";
import { useMediaPlayerShortcutHints } from "./MediaPlayer";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

function collectHints(fullscreen: boolean) {
    const host = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);

    function Probe() {
        useMediaPlayerShortcutHints({ fullscreen });
        return null;
    }
    act(() => render(<ParentComponent.Provider value={host}><Probe /></ParentComponent.Provider>, container));
    return collectShortcutHints(host);
}

describe("useMediaPlayerShortcutHints", () => {
    it("registers playback (incl. fullscreen) and navigation for video", () => {
        const sections = collectHints(true);

        expect(sections.map(s => s.titleKey)).toEqual([ "media.hints.playback", "media.hints.navigation" ]);
        expect(sections[0].hints.map(h => h.labelKey)).toEqual([
            "media.hints.play_pause",
            "media.hints.back_10s",
            "media.hints.forward_10s",
            "media.hints.jump_start",
            "media.hints.jump_end",
            "media.hints.mute",
            "media.hints.fullscreen"
        ]);
        expect(sections[1].hints.map(h => h.labelKey)).toEqual([ "media.hints.previous", "media.hints.next" ]);
    });

    it("omits fullscreen for audio", () => {
        const sections = collectHints(false);

        expect(sections[0].hints.map(h => h.labelKey)).toEqual([
            "media.hints.play_pause",
            "media.hints.back_10s",
            "media.hints.forward_10s",
            "media.hints.jump_start",
            "media.hints.jump_end",
            "media.hints.mute"
        ]);
    });
});
