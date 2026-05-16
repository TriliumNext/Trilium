/**
 * Re-exports the password service from core.
 * changePassword and setPassword are now async - callers must use await.
 */
export { default } from "@triliumnext/core/src/services/encryption/password.js";
