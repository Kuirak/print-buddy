# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`. Wayfinder maps live in `.wayfinder/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is a `Status:` line near the top of each spec or issue file (see `triage-labels.md`)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. One directory per effort: `.wayfinder/<effort>/`.

- **Map**: `.wayfinder/<effort>/map.md` (Destination / Notes / Decisions so far / Not yet specified / Out of scope).
- **Child ticket**: `.wayfinder/<effort>/<NN>-<type>-<slug>.md`, numbered from `01`. YAML frontmatter holds `title`, `type` (`research`/`prototype`/`grilling`/`task`), `status` (`open`/`closed`), `assignee` (empty = unclaimed) and `blocked_by` (list of ticket file stems). The body holds `## Question`.
- **Blocking**: `blocked_by`. A ticket is unblocked when every ticket it lists is `closed`.
- **Frontier**: open, unassigned tickets whose blockers are all closed; lowest number first.
- **Claim**: set `assignee` to the dev driving the map and commit before any work.
- **Resolve**: add a `## Resolution` section, set `status: closed`, then add a one-line gist with a link to the map's Decisions so far.
- **Research findings** go on throwaway local `research/<name>` branches, never merged.
