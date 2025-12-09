"use strict";

import { dayjs } from "@triliumnext/commons";
import AndExp from "../expressions/and.js";
import OrExp from "../expressions/or.js";
import NotExp from "../expressions/not.js";
import ChildOfExp from "../expressions/child_of.js";
import DescendantOfExp from "../expressions/descendant_of.js";
import ParentOfExp from "../expressions/parent_of.js";
import RelationWhereExp from "../expressions/relation_where.js";
import PropertyComparisonExp from "../expressions/property_comparison.js";
import AttributeExistsExp from "../expressions/attribute_exists.js";
import LabelComparisonExp from "../expressions/label_comparison.js";
import NoteFlatTextExp from "../expressions/note_flat_text.js";
import NoteContentFulltextExp from "../expressions/note_content_fulltext.js";
import OrderByAndLimitExp from "../expressions/order_by_and_limit.js";
import AncestorExp from "../expressions/ancestor.js";
import buildComparator from "./build_comparator.js";
import ValueExtractor from "../value_extractor.js";
import { removeDiacritic } from "../../utils.js";
import TrueExp from "../expressions/true.js";
import IsHiddenExp from "../expressions/is_hidden.js";
import type SearchContext from "../search_context.js";
import type { TokenData, TokenStructure } from "./types.js";
import type Expression from "../expressions/expression.js";

function getFulltext(_tokens: TokenData[], searchContext: SearchContext, leadingOperator?: string) {
    const tokens: string[] = _tokens.map((t) => removeDiacritic(t.token));

    searchContext.highlightedTokens.push(...tokens);

    if (tokens.length === 0) {
        return null;
    }

    // If user specified "=" at the beginning, they want exact match
    const operator = leadingOperator === "=" ? "=" : "*=*";

    if (!searchContext.fastSearch) {
        // For exact match with "=", we need different behavior
        if (leadingOperator === "=" && tokens.length >= 1) {
            // Exact match on title OR exact match on content OR exact match in flat text (includes attributes)
            // For multi-word, join tokens with space to form exact phrase
            const titleSearchValue = tokens.join(" ");
            return new OrExp([
                new PropertyComparisonExp(searchContext, "title", "=", titleSearchValue),
                new NoteContentFulltextExp("=", { tokens, flatText: false }),
                new NoteContentFulltextExp("=", { tokens, flatText: true })
            ]);
        }
        return new OrExp([new NoteFlatTextExp(tokens), new NoteContentFulltextExp(operator, { tokens, flatText: true })]);
    } else {
        return new NoteFlatTextExp(tokens);
    }
}

const OPERATORS = new Set(["=", "!=", "*=*", "*=", "=*", ">", ">=", "<", "<=", "%=", "~=", "~*"]);

function isOperator(token: TokenData) {
    if (Array.isArray(token)) {
        return false;
    }

    return OPERATORS.has(token.token);
}

function getExpression(tokens: TokenData[], searchContext: SearchContext, level = 0) {
    if (tokens.length === 0) {
        return null;
    }

    const expressions: Expression[] = [];
    let op: string | null = null;

    let i: number;

    function context(i: number) {
        let { startIndex, endIndex } = tokens[i];
        startIndex = Math.max(0, (startIndex || 0) - 20);
        endIndex = Math.min(searchContext.originalQuery.length, (endIndex || Number.MAX_SAFE_INTEGER) + 20);

        return `"${startIndex !== 0 ? "..." : ""}${searchContext.originalQuery.substr(startIndex, endIndex - startIndex)}${endIndex !== searchContext.originalQuery.length ? "..." : ""}"`;
    }

    const resolveConstantOperand = () => {
        const operand = tokens[i];

        if (!operand.inQuotes && (operand.token.startsWith("#") || operand.token.startsWith("~") || operand.token === "note")) {
            searchContext.addError(`Error near token "${operand.token}" in ${context(i)}, it's possible to compare with constant only.`);
            return null;
        }

        if (operand.inQuotes || !["now", "today", "month", "year"].includes(operand.token)) {
            return operand.token;
        }

        let delta = 0;

        if (i + 2 < tokens.length) {
            if (tokens[i + 1].token === "+") {
                i += 2;

                delta += parseInt(tokens[i].token);
            } else if (tokens[i + 1].token === "-") {
                i += 2;

                delta -= parseInt(tokens[i].token);
            }
        }

        let format, date;

        if (operand.token === "now") {
            date = dayjs().add(delta, "second");
            format = "YYYY-MM-DD HH:mm:ss";
        } else if (operand.token === "today") {
            date = dayjs().add(delta, "day");
            format = "YYYY-MM-DD";
        } else if (operand.token === "month") {
            date = dayjs().add(delta, "month");
            format = "YYYY-MM";
        } else if (operand.token === "year") {
            date = dayjs().add(delta, "year");
            format = "YYYY";
        } else {
            throw new Error(`Unrecognized keyword: ${operand.token}`);
        }

        return date.format(format);
    };

    const parseNoteProperty: () => Expression | undefined | null = () => {
        if (tokens[i].token !== ".") {
            searchContext.addError('Expected "." to separate field path');
            return;
        }

        i++;

        if (["content", "rawcontent"].includes(tokens[i].token)) {
            const raw = tokens[i].token === "rawcontent";

            i += 1;

            const operator = tokens[i];

            if (!isOperator(operator)) {
                searchContext.addError(`After content expected operator, but got "${operator.token}" in ${context(i)}`);
                return;
            }

            i++;

            return new NoteContentFulltextExp(operator.token, { tokens: [tokens[i].token], raw });
        }

        if (tokens[i].token === "parents") {
            i += 1;

            const expression = parseNoteProperty();
            if (!expression) {
                return;
            }
            return new ChildOfExp(expression);
        }

        if (tokens[i].token === "children") {
            i += 1;

            const expression = parseNoteProperty();
            if (!expression) {
                return;
            }
            return new ParentOfExp(expression);
        }

        if (tokens[i].token === "ancestors") {
            i += 1;

            const expression = parseNoteProperty();
            if (!expression) {
                return;
            }
            return new DescendantOfExp(expression);
        }

        if (tokens[i].token === "labels") {
            if (tokens[i + 1].token !== ".") {
                searchContext.addError(`Expected "." to separate field path, got "${tokens[i + 1].token}" in ${context(i)}`);
                return;
            }

            i += 2;

            return parseLabel(tokens[i].token);
        }

        if (tokens[i].token === "relations") {
            if (tokens[i + 1].token !== ".") {
                searchContext.addError(`Expected "." to separate field path, got "${tokens[i + 1].token}" in ${context(i)}`);
                return;
            }

            i += 2;

            return parseRelation(tokens[i].token);
        }

        if (tokens[i].token === "text") {
            if (tokens[i + 1].token !== "*=*") {
                searchContext.addError(`Virtual attribute "note.text" supports only *=* operator, instead given "${tokens[i + 1].token}" in ${context(i)}`);
                return;
            }

            i += 2;

            return new OrExp([new PropertyComparisonExp(searchContext, "title", "*=*", tokens[i].token), new NoteContentFulltextExp("*=*", { tokens: [tokens[i].token] })]);
        }

        if (PropertyComparisonExp.isProperty(tokens[i].token)) {
            const propertyName = tokens[i].token;
            const operator = tokens[i + 1].token;

            i += 2;

            const comparedValue = resolveConstantOperand();
            if (!comparedValue) {
                searchContext.addError(`Unresolved constant operand.`);
                return;
            }

            return new PropertyComparisonExp(searchContext, propertyName, operator, comparedValue);
        }

        searchContext.addError(`Unrecognized note property "${tokens[i].token}" in ${context(i)}`);
    };

    function parseAttribute(name: string) {
        const isLabel = name.startsWith("#");

        name = name.substr(1);

        const isNegated = name.startsWith("!");

        if (isNegated) {
            name = name.substr(1);
        }

        const subExp = isLabel ? parseLabel(name) : parseRelation(name);

        return subExp && isNegated ? new NotExp(subExp) : subExp;
    }

    function parseLabel(labelName: string) {
        searchContext.highlightedTokens.push(labelName);

        if (i < tokens.length - 2 && isOperator(tokens[i + 1])) {
            let operator = tokens[i + 1].token;

            i += 2;

            const comparedValue = resolveConstantOperand();

            if (comparedValue === null) {
                return;
            }

            searchContext.highlightedTokens.push(comparedValue);

            if (searchContext.fuzzyAttributeSearch && operator === "=") {
                operator = "*=*";
            }

            const comparator = buildComparator(operator, comparedValue);

            if (!comparator) {
                searchContext.addError(`Can't find operator '${operator}' in ${context(i - 1)}`);
            } else {
                return new LabelComparisonExp("label", labelName, comparator);
            }
        } else {
            return new AttributeExistsExp("label", labelName, searchContext.fuzzyAttributeSearch);
        }
    }

    function parseRelation(relationName: string) {
        searchContext.highlightedTokens.push(relationName);

        if (i < tokens.length - 2 && tokens[i + 1].token === ".") {
            i += 1;

            const expression = parseNoteProperty();
            if (!expression) {
                return;
            }
            return new RelationWhereExp(relationName, expression);
        } else if (i < tokens.length - 2 && isOperator(tokens[i + 1])) {
            searchContext.addError(`Relation can be compared only with property, e.g. ~relation.title=hello in ${context(i)}`);

            return null;
        } else {
            return new AttributeExistsExp("relation", relationName, searchContext.fuzzyAttributeSearch);
        }
    }

    function parseOrderByAndLimit() {
        const orderDefinitions: {
            valueExtractor: ValueExtractor;
            direction: string;
        }[] = [];
        let limit: number | undefined = undefined;

        if (tokens[i].token === "orderby") {
            do {
                const propertyPath: string[] = [];
                let direction = "asc";

                do {
                    i++;

                    propertyPath.push(tokens[i].token);

                    i++;
                } while (i < tokens.length && tokens[i].token === ".");

                if (i < tokens.length && ["asc", "desc"].includes(tokens[i].token)) {
                    direction = tokens[i].token;
                    i++;
                }

                const valueExtractor = new ValueExtractor(searchContext, propertyPath);

                const validationError = valueExtractor.validate();
                if (validationError) {
                    searchContext.addError(validationError);
                }

                orderDefinitions.push({
                    valueExtractor,
                    direction
                });
            } while (i < tokens.length && tokens[i].token === ",");
        }

        if (i < tokens.length && tokens[i].token === "limit") {
            limit = parseInt(tokens[i + 1].token);
        }

        return new OrderByAndLimitExp(orderDefinitions, limit);
    }

    function getAggregateExpression() {
        if (op === null || op === "and") {
            return AndExp.of(expressions);
        } else if (op === "or") {
            return OrExp.of(expressions);
        } else {
            throw new Error(`Unrecognized op=${op}`);
        }
    }

    for (i = 0; i < tokens.length; i++) {
        if (Array.isArray(tokens[i])) {
            const expression = getExpression(tokens[i] as unknown as TokenData[], searchContext, level++);
            if (expression) {
                expressions.push(expression);
            }
            continue;
        }

        const token = tokens[i].token;

        if (token === "#" || token === "~") {
            continue;
        }

        if (token.startsWith("#") || token.startsWith("~")) {
            const attribute = parseAttribute(token);
            if (attribute) {
                expressions.push(attribute);
            }
        } else if (["orderby", "limit"].includes(token)) {
            if (level !== 0) {
                searchContext.addError("orderBy can appear only on the top expression level");
                continue;
            }

            const exp = parseOrderByAndLimit();

            if (!exp) {
                continue;
            }

            exp.subExpression = getAggregateExpression();
            return exp;
        } else if (token === "not") {
            i += 1;

            if (!Array.isArray(tokens[i])) {
                searchContext.addError(`not keyword should be followed by sub-expression in parenthesis, got ${tokens[i].token} instead`);
                continue;
            }

            const tokenArray = tokens[i] as unknown as TokenData[];
            const expression = getExpression(tokenArray, searchContext, level++);
            if (!expression) {
                return;
            }
            expressions.push(new NotExp(expression));
        } else if (token === "note") {
            i++;

            const expression = parseNoteProperty();
            if (!expression) {
                return;
            }
            expressions.push(expression);

            continue;
        } else if (["and", "or"].includes(token)) {
            if (!op) {
                op = token;
            } else if (op !== token) {
                searchContext.addError("Mixed usage of AND/OR - always use parenthesis to group AND/OR expressions.");
            }
        } else if (isOperator({ token: token })) {
            searchContext.addError(`Misplaced or incomplete expression "${token}"`);
        } else {
            searchContext.addError(`Unrecognized expression "${token}"`);
        }

        if (!op && expressions.length > 1) {
            op = "and";
        }
    }

    return getAggregateExpression();
}

export interface ParseOpts {
    fulltextTokens: TokenData[];
    expressionTokens: TokenStructure;
    searchContext: SearchContext;
    originalQuery?: string;
    leadingOperator?: string;
}

function parse({ fulltextTokens, expressionTokens, searchContext, leadingOperator }: ParseOpts) {
    let expression: Expression | undefined | null;

    try {
        expression = getExpression(expressionTokens as TokenData[], searchContext);
    } catch (e: any) {
        searchContext.addError(e.message);

        expression = new TrueExp();
    }

    let exp = AndExp.of([
        searchContext.includeArchivedNotes ? null : new PropertyComparisonExp(searchContext, "isarchived", "=", "false"),
        getAncestorExp(searchContext),
        getFulltext(fulltextTokens, searchContext, leadingOperator),
        expression
    ]);

    if (searchContext.limit && !searchContext.orderBy) {
        const filterExp = exp;
        exp = new OrderByAndLimitExp([], searchContext.limit || undefined);
        (exp as any).subExpression = filterExp;
    }

    if (searchContext.orderBy && searchContext.orderBy !== "relevancy") {
        const filterExp = exp;

        exp = new OrderByAndLimitExp(
            [
                {
                    valueExtractor: new ValueExtractor(searchContext, ["note", searchContext.orderBy]),
                    direction: searchContext.orderDirection
                }
            ],
            searchContext.limit || undefined
        );

        (exp as any).subExpression = filterExp;
    }

    return exp;
}

function getAncestorExp({ ancestorNoteId, ancestorDepth, includeHiddenNotes }: SearchContext) {
    if (ancestorNoteId && ancestorNoteId !== "root") {
        return new AncestorExp(ancestorNoteId, ancestorDepth);
    } else if (!includeHiddenNotes) {
        return new NotExp(new IsHiddenExp());
    } else {
        return null;
    }
}

export default parse;
