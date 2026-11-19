# Issue tracker: local markdown

Issues and specs for this repo live as markdown files in `.scratch/`. Wayfinder maps live in `.wayfinder/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is a `Status:` line near the top of each spec or issue file. `triage-labels.md` lists the states.
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/`. Create the directory if needed.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. One directory per effort: `.wayfinder/<effort>/`.

- **Map.** `.wayfinder/<effort>/map.md`, with the sections Destination, Notes, Decisions so far, Not yet specified and Out of scope.
- **Child ticket.** `.wayfinder/<effort>/<NN>-<type>-<slug>.md`, numbered from `01`. YAML frontmatter holds `title`, `type`, `status`, `assignee` and `blocked_by`. `type` is one of `research`, `prototype`, `grilling` or `task`. `status` is `open` or `closed`. An empty `assignee` means unclaimed. `blocked_by` is a list of ticket file stems. The body holds `## Question`.
- **Blocking.** `blocked_by`. A ticket is unblocked when every ticket it lists is `closed`.
- **Frontier.** Open, unassigned tickets whose blockers are all closed, lowest number first.
- **Claim.** Set `assignee` to the dev driving the map and commit before any work.
- **Resolve.** Add a `## Resolution` section, set `status: closed`, then add a one-line gist with a link to the map's Decisions so far.
- **Research findings** go on throwaway local `research/<name>` branches, never merged.
