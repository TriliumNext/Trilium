import { ExternalTokenizer } from "@lezer/lr";
import {
    AxisFormat,
    DateFormat,
    Excludes,
    InclusiveEndDates,
    Section,
    TickInterval,
    Title,
    TodayMarker,
    Weekday,
    text
} from "./parser.terms.js";

const keywordMap: { [key: string]: number } = {
    axisFormat: AxisFormat,
    dateFormat: DateFormat,
    excludes: Excludes,
    inclusiveEndDates: InclusiveEndDates,
    section: Section,
    tickInterval: TickInterval,
    title: Title,
    todayMarker: TodayMarker,
    weekday: Weekday
};

const keywords = Object.keys(keywordMap);

export const textToken = new ExternalTokenizer((input) => {
    if (input.next === 32 || input.next === 10 || input.next === -1) return;

    if (input.next === 37 && input.peek(1) === 37) {
        return;
    }

    let tokens = "";

    while (input.next !== 10 && input.next !== -1) {
        tokens += String.fromCodePoint(input.next);
        input.advance();
    }

    const activeKeyword = keywords.filter((keyword) => {
        if (keyword === tokens) {
            return tokens.startsWith(keyword);
        }
        return tokens.startsWith(keyword + " ");
    });

    if (activeKeyword.length > 0) {
        input.acceptToken(
            keywordMap[activeKeyword[0]],
            activeKeyword[0].length - tokens.length
        );
        return;
    }

    input.acceptToken(text);
});
