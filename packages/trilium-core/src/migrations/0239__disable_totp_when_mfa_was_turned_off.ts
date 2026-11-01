import { getSql } from "../services/sql";

/**
 * Restores the intent of anyone who had turned MFA off before v0.104.0 removed the switch that
 * expressed it.
 *
 * Up to v0.103.x, `mfaEnabled` was the master switch and login gated on all three of:
 *
 *     mfaEnabled === "true" && mfaMethod === "totp" && isTotpSecretSet()
 *
 * v0.104.0 removed the enable checkbox (69022d2cb8) and made enrolment itself the switch, dropping
 * the first term. But v0.103's disable path only ever set the flag — it never cleared the secret — so
 * an upgraded install can carry a live secret alongside `mfaMethod` at its `"totp"` default. With the
 * flag no longer read, the two surviving terms are both true and TOTP silently switches back on,
 * confronting the owner with a prompt they deliberately turned off and, without an authenticator
 * still enrolled, locking them out of the web UI entirely (#10576).
 *
 * Clearing the secret is the right expression of "off" under the new model, where a secret being set
 * *is* what enables TOTP. Recovery codes are deliberately left alone: they are only ever consulted
 * behind `isTotpEnabled()` (see `verifyTOTP` in services/auth), so they become unreachable along with
 * the secret, and re-enrolling overwrites them anyway.
 *
 * Deliberately raw SQL: migrations run before becca is populated, so the options service is not yet
 * usable here. The rows are read back into the cache when becca loads later in startup.
 */
export default () => {
    const sql = getSql();

    const legacyMfaEnabled = sql.getValue<string | null>(
        "SELECT value FROM options WHERE name = 'mfaEnabled'"
    );

    // Only an explicit "false" is acted on. A missing row means the install predates the flag or has
    // already been migrated, and "true" means MFA was wanted — in both cases enrolment stands.
    if (legacyMfaEnabled === "false") {
        sql.execute(`
            UPDATE options
               SET value = '', utcDateModified = ?
             WHERE name IN ('totpEncryptionSalt', 'totpEncryptedSecret', 'totpVerificationHash')`,
            [new Date().toISOString()]
        );
    }

    // The flag no longer means anything to any version we can upgrade to, so drop it rather than
    // leave a row that reads as meaningful. Options are keyed by name, so this is idempotent.
    sql.execute("DELETE FROM options WHERE name = 'mfaEnabled'");
    sql.execute("DELETE FROM entity_changes WHERE entityName = 'options' AND entityId = 'mfaEnabled'");
};
