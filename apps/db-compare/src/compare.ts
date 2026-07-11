import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as jsDiff from "diff";
import path from "path";
import pc from "picocolors";

import { compareTable, COMPARISONS, type TableComparison } from "./comparator.js";

function printDiff(one: string, two: string) {
    const diff = jsDiff.diffChars(one, two);

    diff.forEach((part) => {
        // green for additions, red for deletions, grey for common parts
        const colorize = part.added ? pc.green :
            part.removed ? pc.red : pc.gray;
        process.stderr.write(colorize(part.value));
    });

    console.log("");
}

function printComparison(result: TableComparison) {
    console.log("");
    console.log("--------------------------------------------------------");
    console.log(`${result.table} - ${result.leftCount}/${result.rightCount}`);

    if (result.missingFromRight.length > 0) {
        console.log(`Missing IDs from right table ${result.table}: `, result.missingFromRight);
    }

    if (result.missingFromLeft.length > 0) {
        console.log(`Missing IDs from left table ${result.table}: `, result.missingFromLeft);
    }

    for (const { id, left, right } of result.differingRows) {
        console.log(`Table ${result.table} row with ${result.column}=${id} differs:`);
        console.log("Left: ", left);
        console.log("Right: ", right);
        printDiff(left, right);
    }
}

function openDatabase(filePath: string): DatabaseType {
    return new Database(filePath, { readonly: true, fileMustExist: true });
}

function describeError(e: unknown) {
    return e instanceof Error ? e.message : String(e);
}

function main() {
    const dbLeftPath = process.argv.at(-2);
    const dbRightPath = process.argv.at(-1);

    if (process.argv.length < 4 || !dbLeftPath || !dbRightPath) {
        console.log(`Usage: ${process.argv[0]} ${process.argv[1]} path/to/first.db path/to/second.db`);
        process.exit(1);
    }

    let dbLeft: DatabaseType;
    let dbRight: DatabaseType;

    try {
        dbLeft = openDatabase(dbLeftPath);
    } catch (e) {
        console.error(`Could not load first database at ${path.resolve(dbLeftPath)} due to: ${describeError(e)}`);
        process.exit(2);
    }

    try {
        dbRight = openDatabase(dbRightPath);
    } catch (e) {
        console.error(`Could not load second database at ${path.resolve(dbRightPath)} due to: ${describeError(e)}`);
        process.exit(3);
    }

    for (const comparison of COMPARISONS) {
        let result: TableComparison;

        try {
            result = compareTable(dbLeft, dbRight, comparison);
        } catch (e) {
            // The two databases may use different schema versions, so a table present in one might
            // be missing from the other. Skip it rather than aborting the whole comparison.
            console.error(`Skipping table ${comparison.table}: ${describeError(e)}`);
            continue;
        }

        printComparison(result);
    }
}

try {
    main();
} catch (e) {
    console.error(e);
}
