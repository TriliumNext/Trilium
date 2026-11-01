# Measuring on the user's device

Some bugs exist only on a device that cannot be driven from this machine: mobile Safari's keyboard,
the visual viewport, touch scrolling. Playwright's WebKit opens no on-screen keyboard, and there is
no Mac to attach Safari's Web Inspector. Reasoning from the specs about what such a browser reports
has produced wrong models of it — Safari with the keyboard up scrolls the `position: fixed` page
itself, which no reading of the code predicted. Measure instead: have the device write readings to
the dev server's log, then read and replay them here.

## The channel: `window.logInfo` into the server log

The client already sends `logInfo(message)` over the WebSocket (`log-info`, `services/ws.ts`), and
the server writes it to its log as `JS Info: <message>`. Under `pnpm server:start`
(`TRILIUM_DATA_DIR=data`) that log is `apps/server/data/log/trilium-<YYYY-MM-DD>.log`, which you
can read directly. The user opens the dev server on the device over the LAN; nothing else is set
up, no route is added and no screenshot is needed.

This needs the server build in the device's browser. The Capacitor app and standalone run core in
a worker with no server log behind the WebSocket, so a bug only the app shows needs the native
side's logging instead (see the `developing-capacitor-mobile` skill).

## Adding the logging

Keep it temporary and uncommitted, and mark it so it is easy to find and remove:

```ts
// TEMPORARY: iOS Safari viewport diagnostics, sent to the server log as `JS Info: [ios-viewport] …`.
let viewportLogSequence = 0;
function logViewport(reason: string, element: HTMLElement | null, anchor?: HTMLElement | null) {
    const viewport = window.visualViewport;
    const round = (value: number | undefined) =>
        value === undefined ? undefined : Math.round(value * 10) / 10;
    const rect = (target: Element | null | undefined) => {
        if (!target) return undefined;
        const { top, bottom } = target.getBoundingClientRect();
        return { top: round(top), bottom: round(bottom) };
    };
    window.logInfo?.(`[ios-viewport] ${JSON.stringify({
        seq: ++viewportLogSequence,
        t: Math.round(performance.now()),
        reason,
        innerHeight: window.innerHeight,
        scrollY: round(window.scrollY),
        vv: viewport && {
            height: round(viewport.height), offsetTop: round(viewport.offsetTop),
            pageTop: round(viewport.pageTop), scale: round(viewport.scale)
        },
        root: rect(document.getElementById("root-widget")),
        anchor: rect(anchor),
        styleBottom: element?.style.bottom,
        elementRect: rect(element)
    })}`);
}
```

What makes the readings useful:

- **One JSON line per reading, behind a fixed tag** (`[ios-viewport]`), with a sequence number and
  a timestamp, so the lines can be extracted with one `grep` and parsed without ambiguity.
- **Raw inputs, not only the derived value.** Log every number the code computes from
  (`innerHeight`, `scrollY`, each `visualViewport` field) and, as well, the result as it landed
  (`style.bottom`, the element's own rect). With the inputs you can replay a candidate formula
  offline; with the landed rect you can see the error the user sees.
- **A reference element whose position you know.** `#root-widget` is fixed at the top of the page;
  its rect revealed that client coordinates moved with Safari's scroll (`root.top === -scrollY`),
  which is what the code had wrong.
- **The events the code listens to, and the neighbours it does not** — here `visualViewport` resize
  and scroll, plus window `scroll`, `focusin` and `focusout` — and a second reading some 600ms after
  a focus change, once the platform has finished moving things. A bug in which event is missing
  shows up only in the second group.
- **Which instance logged.** Several copies of a component can be mounted (hidden note splits, a
  popup editor kept in the DOM), and the hidden ones log `0/0` rects. Log the element's class and
  filter on a rendered anchor.
- **Always on for the platform under test, with no URL switch.** The user exercises the real app;
  gate only on what the bug needs (`isIOS()`).
- **`window.logInfo?.()`, optional.** Unit tests have no WebSocket and no `logInfo`, so a plain call
  breaks every spec that renders the component.

Then ask the user to reproduce — and, if another browser on the same device behaves, to repeat it
there, for a reading to compare against.

## Reading the log

Extract the tagged lines into JSON Lines in the scratchpad, then parse them in Python:

```bash
grep -o "\[ios-viewport\] {.*}" apps/server/data/log/trilium-<date>.log \
  | sed 's/^\[ios-viewport\] //' > "$SCRATCHPAD/vv.jsonl"
```

A few minutes of panning writes thousands of lines; do not read them by eye. Count them by
`reason` and by instance first, filter to the readings that matter (here: a rendered anchor and the
keyboard up, `innerHeight - vv.height > 150`), and print an evenly spaced sample as a table with a
derived column for the error — the gap between where the element landed and where it belongs.

## Closing the loop

- **Replay the readings through the candidate fix** before asking for another round on the device:
  compute where each logged reading would place the element under the new formula and report the
  spread. For the Safari toolbar, all 453 keyboard-up readings landed within 0.3px of the intended
  6px margin, which was enough to trust the fix.
- **Turn one reading into a spec** with the logged numbers as its fixture, run it red against the
  old code, then green. The red run's error should equal the defect the log showed (here exactly
  the 118px scroll, counted twice).
- **Remove the logging** once the user confirms the fix on the device, and before committing.
