export default class LogService {

    log(message: string | Error) {
        console.log(message);
    }

    info(message: string | Error) {
        console.info(message);
    }

    error(message: string | Error | unknown) {
        console.error("ERROR: ", message);
    }

    banner(message: string | undefined) {
        if (!message) return;
        const termWidth = (typeof process !== "undefined" && process.stdout?.columns) || 80;
        const maxContent = termWidth - 4; // border + padding
        const words = message.split(" ");
        const lines: string[] = [];
        let current = "";

        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length > maxContent) {
                if (current) lines.push(current);
                current = word;
            } else {
                current = candidate;
            }
        }
        if (current) lines.push(current);

        const width = Math.min(Math.max(...lines.map((l) => l.length)), maxContent) + 4;
        const top = `╔${"═".repeat(width)}╗`;
        const mid = lines.map((l) => `║  ${l.padEnd(width - 4)}  ║`).join("\n");
        const bot = `╚${"═".repeat(width)}╝`;
        console.log(`\n${top}\n${mid}\n${bot}\n`);
    }

    /**
     * Returns the current log contents as a string.
     * Override in platform-specific implementations to return actual log data.
     * @returns The log contents, or null if not available
     */
    getLogContents(): string | null {
        return null;
    }

    /**
     * Records an HTTP request entry. Server platforms override this with
     * structured request logging; other platforms (standalone, desktop preload)
     * have no notion of HTTP requests and leave this as a no-op.
     *
     * Uses structural types so core does not need an express dependency.
     */
    request(_req: { url: string; method: string }, _res: { statusCode: number }, _timeMs: number, _responseLength: number | string = "?"): void {
        // no-op default
    }

}

let log: LogService;

export function initLog(provider?: LogService) {
    log = provider ?? new LogService();
}

export function getLog() {
    if (!log) throw new Error("Log service not initialized.");
    return log;
}
