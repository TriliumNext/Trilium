import { getSql } from "@triliumnext/core";

// Lazy proxy: defers getSql() until first property access. Without this,
// any static import chain that reaches this file crashes if initSql() has
// not been called yet. The server avoids that today only because main.ts
// is careful to use dynamic imports for everything that transitively
// touches sql — an unenforced invariant. Tests hit the trap because
// vitest's beforeAll runs after the test file's static imports resolve.
const sqlProxy = new Proxy({} as ReturnType<typeof getSql>, {
    get(_target, prop, receiver) {
        const sql = getSql();
        const value = Reflect.get(sql, prop, receiver);
        return typeof value === "function" ? value.bind(sql) : value;
    }
});

export default sqlProxy;
