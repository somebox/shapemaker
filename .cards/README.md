# Shapemaker work board

This project-local workspace is the executable backlog for work promoted from
`docs/ROADMAP.md`. Its portable, committed state is `backlog.jsonl`;
`work-cards.db*` is local working state and is intentionally ignored.

## Board conventions

- Read the workspace before writing: `cards --workspace .cards workspace show`.
- `epic` cards state a high-level goal; `story` cards state an outcome and
  observable acceptance; `task` cards state concrete actions and verification.
- Use meaningful titles that remain clear in a done-column scan. Put progress,
  decisions, deviations, and evidence in comments; use `work_log` for repeated
  structured records such as commits, files, measurements, or logs.
- Work normally exits through `review`; a review card includes acceptance,
  verification, and relevant commit/PR evidence. A separate person or session
  records the review outcome when practical.
- File a linked follow-up when a discovery would otherwise block progress;
  leave non-urgent ideas for triage.

## Migration boundary

Concrete refactor items from `docs/ROADMAP.md` were migrated as backlog tasks.
Fabrication and shape-vocabulary sections became outcome-oriented stories because
the roadmap says their user needs and acceptance are not yet concrete. True
struts and the deliberately unscheduled list stay as one triage story: do not
promote an item until a demonstrated user workflow exists. The decision log and
shipped changelog remain documentation, not new cards.

## Use and persistence

```bash
cards --workspace .cards workspace show
cards --workspace .cards           # serverless TUI
cards serve --workspace .cards     # browser UI; open the printed /ui/boards/engineering URL
scripts/cards-board.sh export      # refresh the committed snapshot
scripts/cards-board.sh check       # fail if the snapshot is stale
scripts/cards-board.sh install-hooks  # opt in to pre-commit and pre-push checks
```

Store timestamps as RFC3339 UTC. Do not hand-edit `backlog.jsonl` while a server
is running, import over a non-empty local database, or commit `work-cards.db*`.
