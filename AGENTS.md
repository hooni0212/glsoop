# AGENTS.md

## Repository role

This repository is the Glsoop server and web code repository.

It owns:

- Express routes and server APIs
- SQLite database access and migrations
- authentication, safety, moderation, notifications, monetization, quests, and feed-related server logic
- server-rendered/public web pages and assets

## Branching rules

- Start all work from the `dev` branch.
- Do not work directly on `main`, `master`, or `dev`.
- Create a focused task branch from `dev` before making changes.
- Use descriptive branch names such as `feature/...`, `fix/...`, `chore/...`, or `docs/...`.

## Code/document separation

- Keep this repository focused on server/web code.
- Keep only code-adjacent technical docs here.
- Product planning, feature proposals, QA, release, app review, operations, policy, marketing, and design documents should be written in `glsoop-docs`.
- If a server change requires documentation, update or create the related Markdown file in `glsoop-docs`.

## Server/mobile compatibility

- Unless explicitly instructed otherwise, every user-facing feature should work consistently with `glsoop-mobile`.
- Do not break existing mobile API compatibility.
- Preserve existing API routes, response fields, status codes, and authentication behavior.
- Prefer additive API changes over renaming or removing fields.
- If server behavior changes, check whether `glsoop-mobile` must be updated.
- Expose reusable behavior through server APIs rather than requiring mobile to duplicate business logic.

## Cross-repository checks

- For API changes, inspect `../glsoop-mobile` for existing callers when available.
- If `../glsoop-mobile` is unavailable, document the expected mobile impact in the final report.
- Do not assume unused API fields are safe to remove without checking mobile usage.
- When documentation is needed, check `../glsoop-docs` from this repository root before creating docs inside this repository.
- If `../glsoop-docs` is unavailable, mention that documentation should be added there instead of creating product, QA, release, operations, policy, marketing, or design docs here.

## Source of truth

- Treat this server's actual API behavior as the source of truth.
- If documentation and implementation differ, verify the current implementation first.
- Shared policy decisions such as auth, blocking, reporting, safety, moderation, rewards, notifications, and purchase state should remain server-driven.

## Pre-work reading

Before editing, read the relevant flow at least once.

For route/API work, inspect:

- target route file
- related middleware
- related utilities/services
- database helpers or migrations
- known mobile callers when relevant

For public page work, inspect:

- target HTML page
- related CSS
- related JS
- route or API dependencies

## Non-breaking rules

- Do not remove or rename existing API fields unless explicitly requested.
- Do not edit existing migration files after they have been committed.
- Add new migrations for DB changes.
- Do not modify or commit local SQLite databases, test databases, generated artifacts, or temporary files.
- Keep legacy behavior working when adding new behavior.
- Prefer fallback and alias support during transitions.

## Product direction

- Glsoop is a text-centered literary platform, not an image/video-first social feed.
- Protect the quiet, reading-focused, sincere, paper-like product feeling.
- Avoid changes that make the product feel like a generic Instagram-style clone unless explicitly requested.
- Prioritize writing, reading, saving, and literary discovery experiences.

## Safety and UGC

- Do not weaken reporting, blocking, moderation, account safety, legal consent, or community guideline flows.
- Blocking should remove blocked users' content from the user's experience as immediately as possible.
- UGC-related changes must consider App Store and Google Play review expectations.
- Keep Terms of Service, Privacy Policy, and Community Guidelines flows accessible.

## Release and environment

- Do not change production domain assumptions casually.
- The mobile production API base should remain compatible with `https://glsoop.com`.
- Do not assume `m.glsoop.com` is suitable for the mobile API.
- Do not change deployment, secrets, database paths, or production configuration unless explicitly requested.

## Verification

After changes:

- Run the most relevant available checks from `package.json` when practical.
- For API changes, verify backward compatibility with existing clients.
- For DB changes, verify migration behavior.
- For UI changes, describe manual QA scenarios.
- If a check cannot be run, explain why.

## Final report

When reporting back, include:

- summary of changes
- files changed
- verification performed
- skipped checks with reasons
- remaining risks
- documentation updates made in `glsoop-docs`, if any
