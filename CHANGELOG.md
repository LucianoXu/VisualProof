# Changelog

<!-- Human-maintained: the owner writes this file. Agents do not edit it. -->

What changed in each release of VisualProof, newest first. How releases are made:
[CONTRIBUTING.md](CONTRIBUTING.md), "Branches and releases".

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