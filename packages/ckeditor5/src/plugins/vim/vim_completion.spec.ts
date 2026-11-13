import { describe, expect, it } from "vitest";

import {
    fillIn, findCommand, getArgumentRows, getCommandLineHints, getCommandRows, getExCommands,
    getRangeReading, parseCommandLine
} from "./vim_completion.js";
import { getSearchHints, type Translate, type VimHint } from "./vim_hints.js";

const t: Translate = (message, values = []) =>
    message.replace(/%(\d)/gu, (_match, index: string) => values[Number(index)]);

const COMMANDS = getExCommands(t);

/** The rows for `text`, as `label` with `⏎` after the one that `Enter` runs. */
function rows(text: string) {
    return getCommandRows(parseCommandLine(text), t)
        .map((row) => `${row.label}${row.isDefault ? " ⏎" : ""}${row.isMuted ? " (muted)" : ""}`);
}

/** The hints at the right end for `text`, the emphasized part in capitals. */
function hints(text: string) {
    return getCommandLineHints(parseCommandLine(text), t).map(write);
}

function write({ keys, description, emphasis }: VimHint) {
    const shown = emphasis
        ? description.slice(0, emphasis.start)
            + description.slice(emphasis.start, emphasis.end).toUpperCase()
            + description.slice(emphasis.end)
        : description;
    return [ ...keys, shown ].filter(Boolean).join(" ");
}

describe("the completion of the command line", () => {
    it("reads the range, the name and the rest as the engine does", () => {
        expect(parseCommandLine("")).toEqual({ range: "", name: "", rest: "" });
        expect(parseCommandLine("%s/a/b/")).toEqual({ range: "%", name: "s", rest: "/a/b/" });
        expect(parseCommandLine("'<,'>sor")).toEqual({ range: "'<,'>", name: "sor", rest: "" });
        expect(parseCommandLine("1,5d")).toEqual({ range: "1,5", name: "d", rest: "" });
        expect(parseCommandLine("::.,+3 normal Ax"))
            .toEqual({ range: ".,+3", name: "normal", rest: " Ax" });
        expect(parseCommandLine(" .,+3 normal"))
            .toEqual({ range: "", name: "", rest: ".,+3 normal" });
        expect(parseCommandLine("*")).toEqual({ range: "*", name: "", rest: "" });
        expect(parseCommandLine("&&")).toEqual({ range: "", name: "&", rest: "&" });
    });

    it("finds the command that Enter runs, by the rule of the engine", () => {
        const names = [ "s", "so", "sor", "sort", "setl", "no", "x", "noh", "" ]
            .map((name) => findCommand(name, COMMANDS)?.name ?? null);
        expect(names).toEqual([
            "substitute", null, "sort", "sort", "setlocal", "noremap", "xit", "nohlsearch", null
        ]);
    });

    it("lists the commands that start with the name, the one Enter runs first", () => {
        expect(rows("").slice(0, 5))
            .toEqual([ "s[ubstitute]", "w[rite]", "q[uit]", "noh[lsearch]", "sor[t]" ]);
        expect(rows("s")).toEqual([ "s[ubstitute] ⏎", "sor[t]", "se[t]", "start[insert]" ]);
        expect(rows("so")).toEqual([ "sor[t]" ]);
        expect(rows("w")).toEqual([ "w[rite] ⏎", "wq" ]);
        expect(rows("xyz")).toEqual([ "no command starts with xyz (muted)" ]);
        expect(rows("setl")).toEqual([ "no command starts with setl (muted)" ]);
        expect(rows("'<,'>").slice(0, 3)).toEqual([ "s[ubstitute]", "sor[t]", "ck" ]);
        expect(rows("'<,'>").at(-1)).toBe("mapc[lear]");
        expect(rows("").some((row) => row.startsWith("colo"))).toBe(false);
    });

    it("lists the editor commands of :ck and the options of :set", () => {
        const editorCommands = () => [
            { name: "tableColumn", isEnabled: true }, { name: "insertTable", isEnabled: false },
            { name: "bold", isEnabled: true }
        ];
        const argumentRows = (text: string) => getArgumentRows(parseCommandLine(text), t,
            editorCommands)?.map((row) => `${row.label}${row.isMuted ? " (muted)" : ""}`) ?? null;
        expect(argumentRows("ck ")).toEqual([ "bold", "insertTable (muted)", "tableColumn" ]);
        expect(argumentRows("ck tab")).toEqual([ "tableColumn", "insertTable (muted)" ]);
        expect(argumentRows("set ")).toEqual([ "hints", "nohints" ]);
        expect(getArgumentRows(parseCommandLine("se no"), t, editorCommands)?.[0].summary)
            .toBe("hide the key hints");
        expect(getArgumentRows(parseCommandLine("set "), t, editorCommands)?.[0].summary)
            .toBe("show the key hints");
        for (const text of [ "ck", "ck bold x", "sort ", "xyz a", "set" ]) {
            expect(argumentRows(text)).toBeNull();
        }
    });

    it("writes a row in place of the name or of the argument", () => {
        expect(fillIn("%s/a/", "substitute", false)).toBe("%substitute/a/");
        expect(fillIn("'<,'>so", "sort", false)).toBe("'<,'>sort");
        expect(fillIn("ck tab", "insertTable", true)).toBe("ck insertTable");
        expect(fillIn("set  no", "nohints", true)).toBe("set  nohints");
    });

    it("reads what a range means", () => {
        const readings = [ "%", "'<,'>", ".", "$", "5", "1,5", ".,+3", ".,$", "'a", "1,$", "" ]
            .map((range) => getRangeReading(range, t));
        expect(readings).toEqual([
            "the whole note", "the lines of the selection", "this line", "the last line",
            "line 5", "lines 1 to 5", "this line and the next 3", "from this line to the end",
            null, null, null
        ]);
        expect(hints("1,5")).toEqual([ "lines 1 to 5" ]);
        expect(hints("'a")).toEqual([]);
    });

    it("shows the form of the arguments, the part being typed emphasized", () => {
        expect(hints("noh")).toEqual([ "clear the search highlights" ]);
        expect(hints("w file")).toEqual([ "save now" ]);
        expect(hints("s")).toEqual([]);
        expect(hints("xyz")).toEqual([]);
        expect(hints("%s/")).toEqual(
            [ "PATTERN/replacement/flags", "a JavaScript regular expression" ]);
        expect(hints("s/a\\/b/")).toEqual([
            "pattern/REPLACEMENT/flags", "$1 a group", "$& the whole match", "\\n a line break"
        ]);
        expect(hints("s#a#b#")).toEqual([
            "pattern#replacement#FLAGS", "g every match in the line", "i ignore case",
            "c confirm each"
        ]);
        expect(hints("s/a/b/g/")).toEqual(hints("s/a/b/"));
        expect(hints("s x")).toEqual([]);
        expect(hints("s ")).toEqual([]);
        expect(hints("g/a")).toEqual([ "PATTERN/command", "a JavaScript regular expression" ]);
        expect(hints("v/a/")).toEqual(
            [ "pattern/COMMAND", "runs the command on each matching line" ]);
        expect(hints("sort ")).toEqual([
            "[!] [i] [n] [u] [/pattern/]", "! reverse", "i ignore case", "n by number",
            "u drop duplicates"
        ]);
        expect(hints("imap ")).toEqual(
            [ "{keys} {keys or :command}", "for example :imap jk <Esc>" ]);
        expect(hints("norm ")).toEqual([ "{keys}", "typed on each line of the range" ]);
        expect(hints("delm ")).toEqual([ "{marks}" ]);
        expect(hints("ck ")).toEqual([]);
        expect(hints("set ")).toEqual([]);
    });

    it("tells the search prompt how the pattern is read", () => {
        const search = (pattern: string, isJavaScript = true) =>
            getSearchHints(pattern, isJavaScript, t).map(write);
        expect(search("meeting")).toEqual([
            "Enter go to the match", "↑ ↓ earlier searches", "JavaScript regex", "case ignored"
        ]);
        expect(search("Meeting").at(-1)).toBe("case matched");
        expect(search("Meeting/i").at(-1)).toBe("case ignored");
        expect(search("a\\/B").at(-1)).toBe("case matched");
        expect(search("(a").at(-1)).toBe("incomplete pattern");
        expect(search("(a", false).slice(2)).toEqual([ "Vim regex", "case ignored" ]);
    });
});
