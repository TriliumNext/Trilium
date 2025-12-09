import lex from "./apps/server/dist/services/search/services/lex.js";
import parse from "./apps/server/dist/services/search/services/parse.js";
import SearchContext from "./apps/server/dist/services/search/search_context.js";

// Test the integration of the lexer and parser
const testCases = [
    "=example",
    "example",
    "=hello world"
];

for (const query of testCases) {
    console.log(`\n=== Testing: "${query}" ===`);
    
    const lexResult = lex(query);
    console.log("Lex result:");
    console.log("  Fulltext tokens:", lexResult.fulltextTokens.map(t => t.token));
    console.log("  Leading operator:", lexResult.leadingOperator || "(none)");
    
    const searchContext = new SearchContext.default({ fastSearch: false });
    
    try {
        const expression = parse.default({
            fulltextTokens: lexResult.fulltextTokens,
            expressionTokens: [],
            searchContext,
            originalQuery: query,
            leadingOperator: lexResult.leadingOperator
        });
        
        console.log("Parse result: Success");
        console.log("  Expression type:", expression.constructor.name);
    } catch (e) {
        console.log("Parse result: Error -", e.message);
    }
}
