---
name: Reserved VM singleton preparation
description: Why a deployment-target line, an argv and a signal handler each fail to prove "exactly one feed owner", and what has to stand in for them.
---

# Preparing a platform-guaranteed single feed owner

A provider that counts sockets per API key makes "how many of me are running?" a
correctness question, not an ops question. Three things look like answers and are not.

## A config declaration is not a runtime observation

`.replit` saying `deploymentTarget = "vm"` is a statement of intent read at publish time.
The running process never reads it, and in development anyone can also `export` whatever
environment variable the platform is *believed* to set.

**Rule:** a topology claim may only authorise when it arrives through an attestation key
that has been confirmed against a real deployment. Keep the verified-key list explicitly
empty until one has been observed, so the honest outcome (`UNVERIFIED_ENVIRONMENT_CLAIM`)
is the one the code produces — rather than a plausible-looking guess that a developer can
satisfy locally.

**Why:** an independent review defeated the first version of this gate in one line — set
five environment variables and the "runtime" contract was satisfied from a laptop.

**How to apply:** any future `isDeployment` / topology / identity signal must be checked
against the verified list, not merely read.

## An argv shows one executable, not one process

`node dist/index.mjs` proves a single entrypoint is launched. It says nothing about
whether that entrypoint forks. Token-scanning for `pm2`/`cluster`/`&` only catches the
spellings you thought of; `node -e "...fork(...)"` sails through.

**Rule:** split the question. Argv classification tops out at "single entrypoint"; a
separate build-time audit constant asserts the shipped runtime source spawns no children,
and a test re-derives that audit by scanning the source tree (excluding test infra). Both
are required.

**Why:** the constant then cannot rot — adding `child_process` anywhere in runtime source
fails the test, forcing the audit to be flipped, which closes the gate.

## Every shutdown step needs its own bound

Bounding the feed-close hook but awaiting `server.close()` unbounded leaves a hung
listener able to strand the process in SHUTTING_DOWN with no result at all. Bound each
step separately and report a timeout as *not closed* — never let a timeout collapse into
success.

**Also:** a Reserved VM guarantees one *steady-state* process, not one process at every
instant. Republish overlaps old and new instances and SIGTERMs the old one, so the
handover window is precisely where two feed owners could coexist.
