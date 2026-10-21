# Changelog

<!-- Human-maintained: the owner writes this file. Agents do not edit it. -->

What changed in each release of VisualProof, newest first. How releases are made:
[CONTRIBUTING.md](CONTRIBUTING.md), "Branches and releases".

## 0.8.0

- Follow together: whoever follows a reader, and that reader, see each other's pointer and text selections, anchored to what is under them so they land on the same code, page or element at any screen size; the followed reader's clicks show. The Export window is followed too, its progress and download included.
- See who follows you: a mark on your name, with their names; an agent is told who follows it.
- Number the source window's lines as the file does.
- Approve once: the button says Approve, Approved ✓ (a click withdraws it) or Approve again where the declaration changed; `a` never withdraws. A review box's opinions fold all at once or show all.
- See your own review: the colour scheme Mine, a filter of the target's list (not reviewed by me, stale, commented) and `mine(…)` in a view's scope.
- Record the tips' film in a third of the time, a chapter alone in a few minutes; the film recorded again for 0.8.

## 0.7.0

- Show the source of declarations from outside the project — Mathlib, every other package and Lean's core — in the source window, with Lean's hovers and Open on GitHub at the package's revision. An outside key declaration is printed in its document; a past build shows an outside source where its package is at the same revision as now.
- Put the caret after a link's chip in the conversation's box, not before it.
- Hand an agent the messages of its private channel and the public one in the order they were written.

## 0.6.0

- Talk in the page: one conversation window, your own, always in front of the source and reference windows, opened by its button and never by following. A public channel, *Everyone*, for every person and agent, with `@` mentions that wake an agent; a private channel with each of your own agents. Links of the site show as what they lead to; *Copy link* in the canvas's menu copies one without the key.
- Withdraw an opinion: approve or comment, taken back from beside it, in the panel or a source window; the timeline keeps both.
- Mark a trusted declaration key: a key declaration is any of the target's TCB, counted apart when trusted (+N trusted) and printed in its document. The panel and every source window now have the same review box, the target mark included.
- Show your own personal link again, under your name, and make it anew if it leaked; personal links are kept in full (`person-invites.json`, mode 600). Links made before 0.6.0 are made anew to be shown.
- Send pages only the files whose build status changed: on NavierStokesAndEuler 362 KB → 1 KB as a page connects, 373 → 26 KB per change during a build.
- Following a branch: `--build-timeout <hours>` (6 by default) and `--mathlib-cache own`, a deployment's own Mathlib cache that keeps one version; a build that failed before compiling anything shows as failed, not built; the clone lives in `clone/<repo>/`, and a 0.5.0 deployment keeps its own.
- Refuse writes from pages of other sites, and of other ports of the same host, whatever cookies they carry.
- On a phone: Conversations in ⋯, a bar that keeps the project's name and the build's status readable, and popovers that fit the screen.
- Record the tips' film again for all of this.

## 0.5.0

- Follow a branch of a git repository: `visualproof serve <git URL> [--branch …]` builds each new commit itself, in a clone of its own, and shows its builds, commits and failures; the source window opens the line on GitHub. Whoever can push to that branch runs code on the server ([SECURITY.md](SECURITY.md)).
- Show a VisualProof page, not a 404, to a browser that comes without the key: the site is private, or its link was replaced or revoked. The API and agents still get the 404.
- Redesign the dark theme (midnight): clusters seen in depth, edges that step back when many, the Status colours from quiet to urgent. Text meets WCAG AA contrast in both themes; reduced motion holds on the whole page.
- Lay a board out the same in every browser and on the server, to the last bit, and faster (NavierStokesAndEuler by file: 56 s → 11 s). Nothing kept moves.
- Lighten the server: the review is read once, by its revision (a page on 5,000 opinions: 11.5 → 3.5 MB); the Time Machine no longer holds the server; a server at rest costs next to nothing (7–10 % of a core → 0.4 %); the usage pass starts fewer workers while memory is short.
- Record the tips' film again: 3½ minutes, typing faster, a paper beside the source it formalises.
- Fix the dark ring round every cluster of the Project view in the Status colours, the linear form not following a change of theme, and a not-yet-reviewed grey too close to the clusters'.

## 0.4.4

- Add a layout for upright monitors: the board above, and below it a work area with the panel and the windows stacked beside it. An upright tablet keeps the drawer and the sheet.
- Draw every axiom with a ring, so that axioms are told apart without their colour.
- Answer, on a server without an access key, only the names it is reached at (DNS rebinding). Such a server behind a proxy needs `--public-url` or the new `--allowed-host`, or it answers 403.
- Follow a new build when at the latest one. Zoom in on a large selection no longer freezes the page.
- Fix 84 bugs found by reviewing every part of the page and the server, among them fetching by URL past its limits, history logs cut by a crash, and live updates with a review over 4 MB.

## 0.4.3

- Fix following: a reader who followed someone into the export document, or into the artwork mode, can leave it once following ends.
- Add a layout for tall screens (a tablet upright, a narrow window): the panel rises from the bottom, the side panel is a drawer, and windows dock under the board.

## 0.4.2

- Count a TCB without what is trusted: the selection bar, the panel and the tour say "+N trusted" apart, so that Mathlib's definitions no longer make a TCB of hundreds.
- Show the outside declarations in the live demo's Case II and Kummer views.

## 0.4.1

- Fix the page of read-only readers, the public demo's among them, stopping at "Reading the project…".
- Fix the tips' film stopping after its title in Safari.

## 0.4.0

- Add automatic updates.
- Add the tips' film: a review of Sphere-Packing-Lean in thirteen chapters, with captions.
- Redesign the help: `?` is a menu (Tips, Keys, the tour, About).
- Refine the manual and README.

## 0.3.0

- Add the `visualproof artwork` command: make an artwork's PNG and SVG from a recipe, without a browser.
- Add artwork recipes for agents and a batch export script.
- Add recording an opinion for another reviewer at the same screen (**Speaking for**).
- Refine artwork export.
- Allow read-only readers to open and collapse notes, for themselves alone.
- Add a link to the GitHub repository in the help.
- Add the flt-regular showcase, served as the live demo at https://visualproof-demo.yingte.io.

## 0.2.0

- Add artwork export mode. 
- Add linear view for PDF export. 
- Add the `Direct` mode for node selection.
- Refine mobile browser experience.

## 0.1.0

This first version of VisualProof release.