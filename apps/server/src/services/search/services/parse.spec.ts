import { describe, it, expect } from "vitest";
import AndExp from "../../search/expressions/and.js";
import AttributeExistsExp from "../../search/expressions/attribute_exists.js";
import type Expression from "../../search/expressions/expression.js";
import LabelComparisonExp from "../../search/expressions/label_comparison.js";
import NotExp from "../../search/expressions/not.js";
import NoteContentFulltextExp from "../../search/expressions/note_content_fulltext.js";
import NoteFlatTextExp from "../../search/expressions/note_flat_text.js";
import OrExp from "../../search/expressions/or.js";
import OrderByAndLimitExp from "../../search/expressions/order_by_and_limit.js";
import PropertyComparisonExp from "../../search/expressions/property_comparison.js";
import SearchContext from "../../search/search_context.js";
import { default as parseInternal, type ParseOpts } from "./parse.js";

describe("Parser", () => {
    it("fulltext parser without content", () => {
        const rootExp = parse(
            {
                fulltextTokens: tokens(["hello", "hi"]),
                expressionTokens: [],
                searchContext: new SearchContext()
            },
            AndExp
        );

        expectExpression(rootExp.subExpressions[0], PropertyComparisonExp);
        const orExp = expectExpression(rootExp.subExpressions[2], OrExp);
        const flatTextExp = expectExpression(orExp.subExpressions[0], NoteFlatTextExp);
        expect(flatTextExp.tokens).toEqual(["hello", "hi"]);
    });

    it("fulltext parser with content", () => {
        const rootExp = parse(
            {
                fulltextTokens: tokens(["hello", "hi"]),
                expressionTokens: [],
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const orExp = expectExpression(rootExp.subExpressions[2], OrExp);

        const firstSub = expectExpression(orExp.subExpressions[0], NoteFlatTextExp);
        expect(firstSub.tokens).toEqual(["hello", "hi"]);

        const secondSub = expectExpression(orExp.subExpressions[1], NoteContentFulltextExp);
        expect(secondSub.tokens).toEqual(["hello", "hi"]);
    });

    it("simple label comparison", () => {
        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#mylabel", "=", "text"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);
        const labelComparisonExp = expectExpression(rootExp.subExpressions[2], LabelComparisonExp);
        expect(labelComparisonExp.attributeType).toEqual("label");
        expect(labelComparisonExp.attributeName).toEqual("mylabel");
        expect(labelComparisonExp.comparator).toBeTruthy();
    });

    it("simple attribute negation", () => {
        let rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#!mylabel"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);
        let notExp = expectExpression(rootExp.subExpressions[2], NotExp);
        let attributeExistsExp = expectExpression(notExp.subExpression, AttributeExistsExp);
        expect(attributeExistsExp.attributeType).toEqual("label");
        expect(attributeExistsExp.attributeName).toEqual("mylabel");

        rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["~!myrelation"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);
        notExp = expectExpression(rootExp.subExpressions[2], NotExp);
        attributeExistsExp = expectExpression(notExp.subExpression, AttributeExistsExp);
        expect(attributeExistsExp.attributeType).toEqual("relation");
        expect(attributeExistsExp.attributeName).toEqual("myrelation");
    });

    it("simple label AND", () => {
        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#first", "=", "text", "and", "#second", "=", "text"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const andExp = expectExpression(rootExp.subExpressions[2], AndExp);
        const [firstSub, secondSub] = expectSubexpressions(andExp, LabelComparisonExp, LabelComparisonExp);

        expect(firstSub.attributeName).toEqual("first");
        expect(secondSub.attributeName).toEqual("second");
    });

    it("simple label AND without explicit AND", () => {
        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#first", "=", "text", "#second", "=", "text"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const andExp = expectExpression(rootExp.subExpressions[2], AndExp);
        const [firstSub, secondSub] = expectSubexpressions(andExp, LabelComparisonExp, LabelComparisonExp);

        expect(firstSub.attributeName).toEqual("first");
        expect(secondSub.attributeName).toEqual("second");
    });

    it("simple label OR", () => {
        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#first", "=", "text", "or", "#second", "=", "text"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const orExp = expectExpression(rootExp.subExpressions[2], OrExp);
        const [firstSub, secondSub] = expectSubexpressions(orExp, LabelComparisonExp, LabelComparisonExp);
        expect(firstSub.attributeName).toEqual("first");
        expect(secondSub.attributeName).toEqual("second");
    });

    it("fulltext and simple label", () => {
        const rootExp = parse(
            {
                fulltextTokens: tokens(["hello"]),
                expressionTokens: tokens(["#mylabel", "=", "text"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        const [firstSub, _, thirdSub, fourth] = expectSubexpressions(rootExp, PropertyComparisonExp, undefined, OrExp, LabelComparisonExp);

        expect(firstSub.propertyName).toEqual("isArchived");

        const noteFlatTextExp = expectExpression(thirdSub.subExpressions[0], NoteFlatTextExp);
        expect(noteFlatTextExp.tokens).toEqual(["hello"]);

        expect(fourth.attributeName).toEqual("mylabel");
    });

    it("label sub-expression", () => {
        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#first", "=", "text", "or", ["#second", "=", "text", "and", "#third", "=", "text"]]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const orExp = expectExpression(rootExp.subExpressions[2], OrExp);
        const [firstSub, secondSub] = expectSubexpressions(orExp, LabelComparisonExp, AndExp);

        expect(firstSub.attributeName).toEqual("first");

        const [firstSubSub, secondSubSub] = expectSubexpressions(secondSub, LabelComparisonExp, LabelComparisonExp);
        expect(firstSubSub.attributeName).toEqual("second");
        expect(secondSubSub.attributeName).toEqual("third");
    });

    it("label sub-expression without explicit operator", () => {
        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: tokens(["#first", ["#second", "or", "#third"], "#fourth"]),
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const andExp = expectExpression(rootExp.subExpressions[2], AndExp);
        const [firstSub, secondSub, thirdSub] = expectSubexpressions(andExp, AttributeExistsExp, OrExp, AttributeExistsExp);

        expect(firstSub.attributeName).toEqual("first");

        const [firstSubSub, secondSubSub] = expectSubexpressions(secondSub, AttributeExistsExp, AttributeExistsExp);
        expect(firstSubSub.attributeName).toEqual("second");
        expect(secondSubSub.attributeName).toEqual("third");

        expect(thirdSub.attributeName).toEqual("fourth");
    });

    it("parses limit without order by", () => {
        const rootExp = parse(
            {
                fulltextTokens: tokens(["hello", "hi"]),
                expressionTokens: [],
                searchContext: new SearchContext({ limit: 2 })
            },
            OrderByAndLimitExp
        );

        expect(rootExp.limit).toBe(2);
        expect(rootExp.subExpression).toBeInstanceOf(AndExp);
    });

    describe("orderBy with level > 0", () => {
        it("and grouping parentheses should parse without error", () => {
            const searchContext = new SearchContext();
            const rootExp = parseInternal(
                {
                    fulltextTokens: [],
                    expressionTokens: tokens(["#foo", "and" , ["#bar", "or", "#baz",  ], "orderby", "#priority", "desc"]),
                    searchContext
                }
            );
            expect(searchContext.error).toBeNull();
        });

        it("and not() should parse without error", () => {
            const searchContext = new SearchContext();
            const rootExp = parseInternal(
                {
                    fulltextTokens: [],
                    expressionTokens: tokens(["#foo", "and" , "not", [ "#bar", "=", "baz" ], "orderby", "#priority", "desc"]) ,
                    searchContext
                }
            );
            expect(searchContext.error).toBeNull();
        });
    });
});

describe("Invalid expressions", () => {
    it("incomplete comparison", () => {
        const searchContext = new SearchContext();

        parseInternal({
            fulltextTokens: [],
            expressionTokens: tokens(["#first", "="]),
            searchContext
        });

        expect(searchContext.error).toEqual('Misplaced or incomplete expression "="');
    });

    it("comparison between labels is impossible", () => {
        let searchContext = new SearchContext();
        searchContext.originalQuery = "#first = #second";

        parseInternal({
            fulltextTokens: [],
            expressionTokens: tokens(["#first", "=", "#second"]),
            searchContext
        });

        expect(searchContext.error).toEqual(`Error near token "#second" in "#first = #second", it's possible to compare with constant only.`);

        searchContext = new SearchContext();
        searchContext.originalQuery = "#first = note.relations.second";

        parseInternal({
            fulltextTokens: [],
            expressionTokens: tokens(["#first", "=", "note", ".", "relations", "second"]),
            searchContext
        });

        expect(searchContext.error).toEqual(`Error near token "note" in "#first = note.relations.second", it's possible to compare with constant only.`);

        const rootExp = parse(
            {
                fulltextTokens: [],
                expressionTokens: [
                    { token: "#first", inQuotes: false },
                    { token: "=", inQuotes: false },
                    { token: "#second", inQuotes: true }
                ],
                searchContext: new SearchContext()
            },
            AndExp
        );

        assertIsArchived(rootExp.subExpressions[0]);

        const labelComparisonExp = expectExpression(rootExp.subExpressions[2], LabelComparisonExp);
        expect(labelComparisonExp.attributeType).toEqual("label");
        expect(labelComparisonExp.attributeName).toEqual("first");
        expect(labelComparisonExp.comparator).toBeTruthy();
    });

    it("searching by relation without note property", () => {
        const searchContext = new SearchContext();

        parseInternal({
            fulltextTokens: [],
            expressionTokens: tokens(["~first", "=", "text", "-", "abc"]),
            searchContext
        });

        expect(searchContext.error).toEqual('Relation can be compared only with property, e.g. ~relation.title=hello in ""');
    });
});

type ClassType<T extends Expression> = new (...args: any[]) => T;

function tokens(toks: (string | string[])[], cur = 0): Array<any> {
    return toks.map((arg) => {
        if (Array.isArray(arg)) {
            return tokens(arg, cur);
        } else {
            cur += arg.length;

            return {
                token: arg,
                inQuotes: false,
                startIndex: cur - arg.length,
                endIndex: cur - 1
            };
        }
    });
}

function assertIsArchived(_exp: Expression) {
    const exp = expectExpression(_exp, PropertyComparisonExp);
    expect(exp.propertyName).toEqual("isArchived");
    expect(exp.operator).toEqual("=");
    expect(exp.comparedValue).toEqual("false");
}

/**
 * Parses the corresponding {@link Expression} from plain text, while also expecting the resulting expression to be of the given type.
 *
 * @param opts the options for parsing.
 * @param type the expected type of the expression.
 * @returns the expression typecasted to the expected type.
 */
function parse<T extends Expression>(opts: ParseOpts, type: ClassType<T>) {
    return expectExpression(parseInternal(opts), type);
}

/**
 * Expects the given {@link Expression} to be of the given type.
 *
 * @param exp an instance of an {@link Expression}.
 * @param type a type class such as {@link AndExp}, {@link OrExp}, etc.
 * @returns the same expression typecasted to the expected type.
 */
function expectExpression<T extends Expression>(exp: Expression, type: ClassType<T>) {
    expect(exp).toBeInstanceOf(type);
    return exp as T;
}

/**
 * For an {@link AndExp}, it goes through all its subexpressions (up to fourth) and checks their type and returns them as a typecasted array.
 * Each subexpression can have their own type.
 *
 * @param exp the expression containing one or more subexpressions.
 * @param firstType the type of the first subexpression.
 * @param secondType the type of the second subexpression.
 * @param thirdType the type of the third subexpression.
 * @param fourthType the type of the fourth subexpression.
 * @returns an array of all the subexpressions (in order) typecasted to their expected type.
 */
function expectSubexpressions<FirstT extends Expression, SecondT extends Expression, ThirdT extends Expression, FourthT extends Expression>(
    exp: AndExp,
    firstType: ClassType<FirstT>,
    secondType?: ClassType<SecondT>,
    thirdType?: ClassType<ThirdT>,
    fourthType?: ClassType<FourthT>
): [FirstT, SecondT, ThirdT, FourthT] {
    expectExpression(exp.subExpressions[0], firstType);
    if (secondType) {
        expectExpression(exp.subExpressions[1], secondType);
    }
    if (thirdType) {
        expectExpression(exp.subExpressions[2], thirdType);
    }
    if (fourthType) {
        expectExpression(exp.subExpressions[3], fourthType);
    }
    return [exp.subExpressions[0] as FirstT, exp.subExpressions[1] as SecondT, exp.subExpressions[2] as ThirdT, exp.subExpressions[3] as FourthT];
}
