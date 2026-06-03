---
name: Autoscale cold-start transient 500
description: First request to the autoscale prod deployment after idle can return a one-off 500, then recovers on retry — don't flag as a regression.
---

The production deployment is autoscale. The **first** HTTP request after the deployment has scaled to zero / gone idle can return a single transient `500 Internal Server Error` (observed on `POST /api/auth/login`). Immediate retries return 200 and the app behaves normally.

**Why:** autoscale spins the instance up on the first request; the cold-start race can surface as one 500 before the process is fully ready.

**How to apply:** During production smoke tests, always **retry once or twice** before concluding "API 500 regression". A 500 that does not reproduce on retry is a cold-start artifact, not a code fault. Only a *sustained/reproducible* 500 is a real regression.
