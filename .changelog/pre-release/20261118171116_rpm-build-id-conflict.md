---
type: fix
area: Desktop
closes: [8008]
---

Installing the RPM package blocked installing other Electron apps (such as Unity Hub) with a file conflict under `/usr/lib/.build-id`.
