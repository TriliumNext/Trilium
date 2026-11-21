---
type: fix
area: Server
---

The provided `docker-compose.yml` failed to start the container on hosts without `/etc/timezone`, such as Fedora, RHEL or Alpine.