---
type: security
area: Sync
closes: [8209, 8272, 5650]
notable: true
---

Synchronizing with a new device now requires TOTP if one is set. Existing synchronization is not affected. The secret length has also been increased but this affects new users only.
