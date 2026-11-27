---
type: security
notable: true
---

Any backup held the secret of the second factor (TOTP) next to the key that opened it, and the factor could be switched off without a code.
After the upgrade, remove TOTP and set it up again before you download a backup. Until then, a download asks for the password and a current code.