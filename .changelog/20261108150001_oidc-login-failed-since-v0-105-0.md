---
type: fix
area: Authentication
closes: [11234, 12301]
notable: true
---

Logging in through OIDC failed since v0.105.0 behind Nginx Proxy Manager ("auth_verification cookie not found") and with Pocket ID.
