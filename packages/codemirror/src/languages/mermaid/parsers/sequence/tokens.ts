import { ExternalTokenizer } from "@lezer/lr";
import {
    _break,
    _else,
    Activate,
    Actor,
    alt,
    and,
    As,
    Autonumber,
    box,
    Create,
    critical,
    Deactivate,
    Destroy,
    End,
    link,
    links,
    loop,
    messageText,
    NodeText,
    Note,
    opt,
    option,
    par,
    Participant,
    Position,
    rect
} from "./parser.terms.js";

const skipCodePoints = [ -1, 9, 10, 13, 32, 37 ];
const arrowSuffixCodePoints = [ 43, 45 ];
const notAllowedCodePoints = [ 44, 58, 62 ];
const notAllowed2Chars = [ "->", "-x", "-)", " -", "  " ];
const notAllowed3Chars = [ "-->", "->>", "--x", "--)", " as" ];

const keywordMap: { [key: string]: number } = {
    "left of": Position,
    "right of": Position,
    "activate": Activate,
    "actor": Actor,
    "alt": alt,
    "and": and,
    "as": As,
    "autonumber": Autonumber,
    "box": box,
    "break": _break,
    "create": Create,
    "critical": critical,
    "deactivate": Deactivate,
    "destroy": Destroy,
    "else": _else,
    "end": End,
    "link": link,
    "links": links,
    "loop": loop,
    "note": Note,
    "opt": opt,
    "option": option,
    "over": Position,
    "par": par,
    "participant": Participant,
    "rect": rect
};

const keywords = Object.keys(keywordMap);

export const messageTextToken = new ExternalTokenizer((input) => {
    if (skipCodePoints.includes(input.next)) return;

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(messageText);
});

export const textTokens = new ExternalTokenizer((input) => {
    if (
        skipCodePoints.includes(input.next) ||
        arrowSuffixCodePoints.includes(input.next)
    )
        return;

    const isArrowNext = () => {
        if (input.peek(0) === -1 || input.peek(1) === -1 || input.peek(2) === -1)
            return false;

        let result =
            String.fromCodePoint(input.peek(0)) + String.fromCodePoint(input.peek(1));

        if (notAllowed2Chars.includes(result)) return true;

        result += String.fromCodePoint(input.peek(2));

        if (notAllowed3Chars.includes(result)) return true;

        return false;
    };

    let tokens = "";

    while (
        !notAllowedCodePoints.includes(input.next) &&
        !isArrowNext() &&
        input.next !== 10 &&
        input.next !== -1
    ) {
        tokens += String.fromCodePoint(input.next);
        input.advance();
    }

    const activeKeyword = keywords.filter((keyword) => {
        if (keyword === tokens) {
            return tokens.toLowerCase().startsWith(keyword);
        }
        return tokens.toLowerCase().startsWith(keyword + " ");
    });

    if (activeKeyword.length > 0) {
        input.acceptToken(
            keywordMap[activeKeyword[0]],
            activeKeyword[0].length - tokens.length
        );
        return;
    }

    input.acceptToken(NodeText);
});
