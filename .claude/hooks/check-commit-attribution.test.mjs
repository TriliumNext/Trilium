// Run with `node --test .claude/hooks/check-commit-attribution.test.mjs`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkCommand, readTranscriptModel, toModelName } from "./check-commit-attribution.mjs";

const TRAILER = "Assisted-by: Claude Code (Claude Opus 5.5)";
const dir = mkdtempSync(join(tmpdir(), "commit-attribution-"));

const PASS = { action: "pass" };

function blockReason(command, modelName = null) {
    const result = checkCommand(command, dir, modelName);
    assert.equal(result.action, "block", command);
    return result.reason;
}

function message(name, text) {
    writeFileSync(join(dir, name), text);
    return name;
}

describe("checkCommand without a model", () => {
    it("passes commands that do not commit, or commit without a message of their own", () => {
        for (const command of [
            "git status --short",
            "grep -rn \"git commit -m wip\" docs",
            "grep -E \"^# pass|git commit -m wip\" out.txt",
            "git log --oneline -5",
            "git commit --amend --no-edit",
            "git commit-graph write"
        ]) {
            assert.deepEqual(checkCommand(command, dir), PASS, command);
        }
    });

    it("passes a message carrying the trailer, inline or in a file", () => {
        const good = message("good.txt", `fix(x): y\n\nBody.\n\n${TRAILER}\n`);
        for (const command of [
            `git commit -F ${good} -- a.ts`,
            `git add a.ts && git -C . commit --file="${good}"`,
            `git commit -m "fix(x): y" -m "${TRAILER}"`,
            `git commit -F - <<'EOF'\nfix(x): y\n\n${TRAILER}\nEOF`,
            `git commit-tree HEAD^{tree} -p HEAD -F ${good}`
        ]) {
            assert.deepEqual(checkCommand(command, dir), PASS, command);
        }
    });

    it("reads a message file whose path holds a variable, set before the commit or in the environment", () => {
        message("good.txt", `fix(x): y

${TRAILER}
`);
        process.env.COMMIT_ATTRIBUTION_TEST_DIR = dir;
        for (const command of [
            `S="${dir}" && git commit -F "$S/good.txt" -- a.ts`,
            `export S='${dir}'; git commit --file="\${S}/good.txt"`,
            "git commit -F \"$COMMIT_ATTRIBUTION_TEST_DIR/good.txt\"",
            `S="${dir}"; T="$S/good.txt"; git commit -F "$T"`
        ]) {
            assert.deepEqual(checkCommand(command, "."), PASS, command);
        }
    });

    it("reads a message file relative to the directories `git -C` names", () => {
        mkdirSync(join(dir, "sub", "deeper"), { recursive: true });
        message(join("sub", "in-sub.txt"), `fix(x): y\n\n${TRAILER}\n`);
        message(join("sub", "deeper", "in-deeper.txt"), `fix(x): y\n\n${TRAILER}\n`);
        for (const command of [
            "git -C sub commit -F in-sub.txt",
            "git -C sub -C deeper commit --file=in-deeper.txt",
            `git -C sub -C "${join(dir, "sub", "deeper")}" commit -F in-deeper.txt`
        ]) {
            assert.deepEqual(checkCommand(command, dir), PASS, command);
        }
    });

    it("reads the message from the commit alone, not from the commands after it", () => {
        for (const command of [
            `git commit -m "fix(x): y" -m "${TRAILER}" && echo "Co-Authored-By: Claude"`,
            `git commit -F - <<'EOF'\nfix(x): y\n\n${TRAILER}\nEOF\n`
                + "git log -1 | grep \"Co-Authored-By: Claude\""
        ]) {
            assert.deepEqual(checkCommand(command, dir), PASS, command);
        }
        for (const command of [
            `git commit -m wip && echo "${TRAILER}"`,
            `git commit -m wip; echo "${TRAILER}"`,
            `git commit -m wip | tee log.txt "${TRAILER}"`,
            `git commit -m wip\necho "${TRAILER}"`
        ]) {
            assert.match(blockReason(command), /Assisted-by: Claude Code \(/, command);
        }
    });

    it("says so when it cannot read the message file, as one written in the same command", () => {
        for (const command of [
            "git commit -F missing.txt",
            "git commit -F \"$UNSET_COMMIT_ATTRIBUTION_DIR/msg.txt\"",
            `printf 'fix(x): y\\n\\n${TRAILER}\\n' > printed.txt && git commit -F printed.txt`
        ]) {
            assert.match(blockReason(command), /Could not read the commit message file/, command);
        }
    });

    it("reads a message file the same command writes from a heredoc", () => {
        for (const command of [
            `cat > new.txt <<'EOF'\nfix(x): y\n\n${TRAILER}\nEOF\ngit commit -F new.txt`,
            `S=sub; cat <<"EOF" > "$S/new.txt"\nfix(x): y\n\n${TRAILER}\nEOF\ngit commit -F "$S/new.txt"`
        ]) {
            assert.deepEqual(checkCommand(command, dir), PASS, command);
        }
    });

    it("blocks a message without the trailer, with a placeholder model, or crediting Claude as co-author", () => {
        const none = message("none.txt", "fix(x): y\n");
        const placeholder = message("placeholder.txt", "fix(x): y\n\nAssisted-by: Claude Code (<model>)\n");
        const coAuthor = message("co-author.txt",
            `fix(x): y\n\n${TRAILER}\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`);
        for (const command of [
            `git commit -F ${none} -- a.ts`,
            `git commit -F ${placeholder}`,
            `git commit -F ${coAuthor}`,
            "git commit -am \"fix(x): y\"",
            "git commit -m \"fix(x): y\" -m \"Assisted-by: Claude Code\"",
            "cd sub; git commit --message=wip",
            `git commit -m a -m "${TRAILER}"; git commit -m b`
        ]) {
            assert.match(blockReason(command), /Assisted-by: Claude Code \(/, command);
        }
    });
});

describe("checkCommand with a model", () => {
    const MODEL = "Claude Opus 5.5";
    const ADD = `--trailer "${TRAILER}"`;

    it("adds the trailer to a commit without it, or whose message file a heredoc writes", () => {
        message("none.txt", "fix(x): y\n");
        for (const [ command, expected ] of [
            [ "git commit -m wip", `git -c trailer.ifexists=addIfDifferent commit ${ADD} -m wip` ],
            [ "git -C sub commit -F ../none.txt -- a.ts",
                `git -c trailer.ifexists=addIfDifferent -C sub commit ${ADD} -F ../none.txt -- a.ts` ],
            [ `cd ${dir} && git commit -F none.txt && git push`,
                `cd ${dir} && git -c trailer.ifexists=addIfDifferent commit ${ADD} -F none.txt && git push` ],
            [ "cat > new.txt <<'EOF'\nfix(x): y\nEOF\ngit commit -F new.txt",
                `cat > new.txt <<'EOF'\nfix(x): y\nEOF\ngit -c trailer.ifexists=addIfDifferent commit ${ADD} -F new.txt` ]
        ]) {
            assert.deepEqual(checkCommand(command, dir, MODEL), { action: "rewrite", command: expected, trailer: TRAILER });
        }
    });

    it("blocks a commit whose message file it cannot read, rather than risk a second trailer", () => {
        assert.match(blockReason("printf 'fix(x): y\\n' > printed.txt && git commit -F printed.txt", MODEL),
            /Could not read the commit message file/);
    });

    it("replaces a malformed Claude line only when it is the last `Assisted-by` line", () => {
        const bare = message("bare.txt", "fix(x): y\n\nAssisted-by: DeepSeek V4\nAssisted-by: Claude Code\n");
        const notLast = message("not-last.txt", "fix(x): y\n\nAssisted-by: Claude Code\nAssisted-by: DeepSeek V4\n");
        const modeOf = (command) => /trailer\.ifexists=(\w+)/.exec(checkCommand(command, dir, MODEL).command)?.[1];
        assert.equal(modeOf(`git commit -F ${bare}`), "replace");
        assert.equal(modeOf("git commit -m \"fix(x): y\" -m \"Assisted-by: Claude Code (<model>)\""), "replace");
        assert.equal(modeOf("git commit -m \"fix(x): y\" -m \"Assisted-by: Claude Opus 5.5\""), "replace");
        assert.equal(modeOf("git commit -m \"fix(x): y\" -m \"Assisted-by: Claude Code <noreply@anthropic.com>\""), "replace");
        assert.equal(modeOf(`git commit -F ${notLast}`), "addIfDifferent");
        assert.equal(modeOf("cat > new.txt <<'EOF'\nfix(x): y\n\nAssisted-by: Claude Code\nEOF\ngit commit -F new.txt"),
            "replace");
    });

    it("rewrites each commit that needs it and leaves the others as they are", () => {
        const { command } = checkCommand(`git commit -m a -m "${TRAILER}"; git commit -m b`, dir, MODEL);
        assert.equal(command, `git commit -m a -m "${TRAILER}"; git -c trailer.ifexists=addIfDifferent commit ${ADD} -m b`);
    });

    it("still passes a good commit and blocks a co-author, a `commit-tree` without the trailer, or an unknown model", () => {
        assert.deepEqual(checkCommand(`git commit -m "fix(x): y" -m "${TRAILER}"`, dir, MODEL), PASS);
        assert.match(blockReason(`git commit -m wip -m "Co-Authored-By: Claude <noreply@anthropic.com>"`, MODEL), /Co-Authored-By/);
        assert.match(blockReason("git commit-tree HEAD^{tree} -p HEAD -m wip", MODEL), /Assisted-by: Claude Code \(/);
        assert.match(blockReason("git commit -m wip"), /Assisted-by: Claude Code \(/);
    });
});

describe("the model", () => {
    it("names a model id as the trailer does", () => {
        assert.equal(toModelName("claude-opus-5-5"), "Claude Opus 5.5");
        assert.equal(toModelName("claude-fable-5-1[1m]"), "Claude Fable 5.1");
        assert.equal(toModelName("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
        assert.equal(toModelName("claude-opus-4"), "Claude Opus 4");
        assert.equal(toModelName("gpt-5"), null);
        assert.equal(toModelName(null), null);
    });

    it("reads the model of the last reply from the transcript, or `null` without one", () => {
        const transcript = join(dir, "transcript.jsonl");
        writeFileSync(transcript, [
            { type: "assistant", message: { model: "claude-sonnet-5-5" } },
            { type: "user", message: { content: "\"assistant\"" } },
            { type: "assistant", message: { model: "claude-opus-5-5" } },
            { type: "user", message: { content: "next" } }
        ].map((entry) => JSON.stringify(entry)).join("\n"));
        assert.equal(readTranscriptModel(transcript), "claude-opus-5-5");
        assert.equal(readTranscriptModel(join(dir, "missing.jsonl")), null);
        assert.equal(readTranscriptModel(message("empty.jsonl", "")), null);
    });
});

describe("the hook", () => {
    const script = fileURLToPath(new URL("./check-commit-attribution.mjs", import.meta.url));
    const transcript = join(dir, "hook-transcript.jsonl");
    writeFileSync(transcript, `${JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } })}\n`);
    const run = (command, transcriptPath = transcript) => spawnSync(process.execPath, [ script ], {
        input: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command, description: "Commit" },
            cwd: dir,
            transcript_path: transcriptPath
        }),
        encoding: "utf8"
    });

    it("rewrites a commit without the trailer through `updatedInput`, keeping the other fields", () => {
        const result = run("git commit -m wip");
        assert.equal(result.status, 0);
        const { hookSpecificOutput } = JSON.parse(result.stdout);
        assert.equal(hookSpecificOutput.hookEventName, "PreToolUse");
        assert.equal(hookSpecificOutput.permissionDecision, undefined);
        assert.deepEqual(hookSpecificOutput.updatedInput, {
            command: `git -c trailer.ifexists=addIfDifferent commit --trailer "${TRAILER}" -m wip`,
            description: "Commit"
        });
        assert.match(hookSpecificOutput.additionalContext, /Assisted-by: Claude Code \(Claude Opus 5\.5\)/);
    });

    it("exits with 2 and explains a blocked commit, and with 0 and no output otherwise", () => {
        const blocked = run("git commit -m wip", join(dir, "missing.jsonl"));
        assert.equal(blocked.status, 2);
        assert.match(blocked.stderr, /Assisted-by/);

        const passed = run("git status");
        assert.equal(passed.status, 0);
        assert.equal(passed.stdout, "");
    });

    it("prints what it does with a command in a dry run, and runs nothing", () => {
        const dryRun = (...args) => spawnSync(process.execPath, [ script, "--dry-run", "--cwd", dir, ...args ], {
            encoding: "utf8"
        }).stdout;
        assert.equal(dryRun("--", "git commit -m wip"),
            `rewrite (${TRAILER}):\ngit -c trailer.ifexists=addIfDifferent commit --trailer "${TRAILER}" -m wip\n`);
        assert.equal(dryRun("--model", "claude-fable-5-1", "--", "git commit -m wip"),
            "rewrite (Assisted-by: Claude Code (Claude Fable 5.1)):\n"
            + "git -c trailer.ifexists=addIfDifferent commit --trailer \"Assisted-by: Claude Code (Claude Fable 5.1)\" -m wip\n");
        assert.match(dryRun("--model", "none", "--", "git commit -m wip"), /^block:\n.*Assisted-by/);
        assert.equal(dryRun("--", "git status"), "pass\n");
    });
});
