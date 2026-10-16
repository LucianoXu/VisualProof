# This VisualProof site's folder

VisualProof keeps here what this site holds of the project: what reviewers said about its
declarations (`log/`), the history of the builds it saw, the library's files, the views and their
layouts, the timeline, conversations with agents, agents' tokens and personal links.

It is local. It holds secrets (agents' tokens, personal links): it is not meant to be committed.
Back it up: none of it can be derived again. What VisualProof can derive again is in its cache
(`--cache`), not here.

- `log/` holds one file per writer: `<name>-<hash>.jsonl` for a person,
  `<name>-<hash>.agent.jsonl` for an AI agent: its opinions are advice, never counted; what else
  it did (a target, a key declaration, a trusted prefix) counts as a person's would, and is shown
  as an agent's. The hash is of the writer's exact name, which every line carries; the file's
  name is only a container.
- Someone invited by a personal link writes to `<id>.person.jsonl`, the id being their link's:
  every line carries it (`person`) beside the name it was written under, and a `name` line says
  they go by another name from then on. All they wrote shows under the latest.
- `log/visualproof.server.jsonl` is VisualProof's own: the renames it found between two builds,
  each a move that carries what was said of the declaration to its new name, and the links it
  carried to a cluster a build renamed as a whole.
- Each line is one event: an opinion on a declaration (bound to its version), a target marked
  or taken off, a prefix trusted without review or no longer, a key declaration of a target marked
  or unmarked, a move of what was said of one declaration to another (or its undoing), a file
  added to the project's library (named by its SHA-256: its bytes are kept beside, in `files/`)
  and its title, archiving and restoring, a link from a declaration or a cluster to a place in one,
  edited or removed.
- Files are only ever appended to, each writer to their own.
- The review is what replaying every file gives: one writer's events in the order of their file,
  different writers' by time.
- Do not edit a line by hand. A line VisualProof cannot read (a line cut short) is reported;
  nothing more is written to that file until it is fixed by hand.
