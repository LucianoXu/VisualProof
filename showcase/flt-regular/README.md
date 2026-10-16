# Showcase: flt-regular

A VisualProof site caught in the middle of a review: three people reading what
[flt-regular](https://github.com/leanprover-community/flt-regular)'s main theorem says, over six
weeks and three real builds of the project, with an AI assistant beside one of them.

Alice, Bob and Charlie are fictional, and so are their words and the documents in the library. The
mathematics, the Lean names and the builds are flt-regular's: the declarations that change from one
build to the next, and so the opinions that go stale, are the project's own.

## The story

- **7 September, build `faae830`** (Lean v4.34.0-rc2). Alice marks `flt_regular` as a target, adds
  the review plan to the library and makes the target's view. Bob takes `Mathlib` off the trusted
  list and puts back every part of it but `Mathlib.NumberTheory`, so that the definitions the
  statement means (`FermatLastTheoremFor`, `CyclotomicField`, `NumberField.RingOfIntegers`) come
  into the review. Charlie takes Kummer's lemma, with his reading notes. They approve and comment;
  a question on `IsRegularNumber` is answered with a quote and approved. Alice's AI advises (shown
  apart, never counted) and links the notes.
- **17 September**, a meeting at one screen: Alice records Charlie's and Bob's approvals for them,
  marks the key declarations and adds the minutes.
- **23 September, build `91d8f19`** (Lean v4.35.0-rc2, a new Mathlib): 77 declarations have a new
  version. Alice's AI says what the build changed; Bob keeps a view of `Hilbert92` at the build
  before; Charlie approves `Hilbert92` again. Bob takes case II. On 1 October Alice's AI makes a
  view to be printed: Export → Document turns it into a PDF of the statement and its steps.
- **14 October, build `b8a5f23`** (Lean v4.35.0): Bob's approval of
  `exists_not_dvd_spanSingleton_eq` goes stale; What changed shows the line, and Alice's AI tells him.

It stops there: `flt_regular` has 7 of 8 approved and one comment open, Kummer's lemma 2 of 5,
two approvals are stale.

## Serve it

You need a built checkout of flt-regular at `b8a5f23` (Lean and elan, about 5 GB with Mathlib's
cache), outside this repository:

```sh
showcase/flt-regular/setup.sh ~/flt-regular-showcase
npm run showcase -- ~/flt-regular-showcase/b8a5f23 --port 4173
```

`npm run showcase` copies `site/` to a new temporary folder and serves it with this checkout's
server: the copy is yours to change. For a public, read-only site, give it a site folder of its own
and a key; whoever comes without the key reads and changes nothing:

```sh
npm run showcase -- ~/flt-regular-showcase/b8a5f23 --site /srv/visualproof/flt-regular \
  --access-key-file /srv/visualproof/flt-regular.key --public --public-url https://example.org
```

`setup.sh` dates the build's `.olean` files at the build's time in `project.json`: the history knows
a build by that time, and another would be another build.

## Make it again

```sh
showcase/flt-regular/setup.sh ~/flt-regular-showcase --all
node showcase/flt-regular/generate.ts ~/flt-regular-showcase
```

`generate.ts` typesets the documents, then plays `story.ts` against a real server on each build in
turn, on the story's clock (`fakeclock.mjs`), and copies the site it made to `site/`. The ids it
makes are random: two runs tell the same story in different bytes.

| | |
|---|---|
| `project.json` | flt-regular's repository and the three builds: commit, toolchain, when built |
| `story.ts` | what everyone does, and when |
| `generate.ts`, `fakeclock.mjs` | the player, and the server's clock |
| `documents/` | the library's documents, as XeLaTeX sources |
| `setup.sh` | the checkouts, built and dated |
| `site/` | the site: the review's logs, history, library, views, notes and timeline. It holds no secret (no access key, agent token or personal link was ever made for it) |
