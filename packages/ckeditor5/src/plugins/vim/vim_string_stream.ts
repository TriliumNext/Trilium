type CharacterMatch = string | RegExp;

/**
 * Reads a string one token at a time, as CodeMirror's `StringStream` does. The Vim engine parses
 * the command line with it.
 */
export default class StringStream {

    pos = 0;

    constructor(readonly string: string) {}

    eol() {
        return this.pos >= this.string.length;
    }

    sol() {
        return this.pos === 0;
    }

    peek(): string | undefined {
        return this.string.charAt(this.pos) || undefined;
    }

    next(): string | undefined {
        return this.eol() ? undefined : this.string.charAt(this.pos++);
    }

    eat(match: CharacterMatch): string | undefined {
        const character = this.string.charAt(this.pos);
        const isMatch = typeof match === "string" ? character === match : match.test(character);
        if (!character || !isMatch) {
            return undefined;
        }
        this.pos++;
        return character;
    }

    eatWhile(match: CharacterMatch): boolean {
        let count = 0;
        while (this.eat(match) !== undefined) {
            count++;
        }
        return count > 0;
    }

    eatSpace(): boolean {
        return this.eatWhile(/[\s\u{a0}]/u);
    }

    skipToEnd() {
        this.pos = this.string.length;
    }

    backUp(count: number) {
        this.pos -= count;
    }

    /**
     * Whether the text at the position starts with `pattern`, or the match of `pattern` there.
     * Moves past it unless `consume` is `false`.
     */
    match(pattern: string | RegExp, consume = true): boolean | RegExpMatchArray | null {
        if (typeof pattern === "string") {
            const isFound = this.string.startsWith(pattern, this.pos);
            if (isFound && consume) {
                this.pos += pattern.length;
            }
            return isFound;
        }
        const found = this.string.slice(this.pos).match(pattern);
        if (!found || (found.index as number) > 0) {
            return null;
        }
        if (consume) {
            this.pos += found[0].length;
        }
        return found;
    }
}
