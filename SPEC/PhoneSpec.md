# VisualProof Phone Spec

The page on a phone, beyond SPEC.md ("Deployment": "The website also supports small touch devices. On
small screens it can have a UI focused on reading and reviewing."), on a tall screen — a tablet
held upright, a narrow window (decisions 16–28, the owner's of 2026-10-17) — and on a monitor turned
on its side (decisions 29–35, the owner's choice of 2026-10-18). How the board itself looks and
behaves: CanvasSpec.md. A tablet held sideways is a larger screen's page; what a finger changes
there is decisions 3–5's.

## Decisions

### What a phone is for

1. **A phone reads, reviews and follows** (the owner's choice of 2026-10-14). A board is arranged on
   a larger screen. Everything else a phone does, it does with the buttons a larger screen has,
   moved or folded away, never a second implementation of them. What only a phone shows (⋯ of the
   bar, the drawer's button) is the reader's own: a follower is not shown it.
2. **A phone is a screen at most 640 px wide** (`PHONE` in `web/src/phone.ts`, the `max-width:
   640px` block at the end of `web/style.css`). A window narrowed to that width becomes a phone's
   page, and one widened from it comes back.

### Fingers on the board

3. **Gestures** (`web/src/canvas.ts`), on any touch screen:
   - one finger dragged moves around;
   - two fingers pinch: the board zooms about their middle and moves with it; what the fingers
     leave after a pinch is no tap;
   - a tap selects, as a click does: a declaration, or a circle for all it holds; a tap on empty
     board selects nothing;
   - a double tap on empty board zooms in there (a double tap folds nothing);
   - a finger held still (500 ms) opens the menu on what is under it, with a short vibration where
     the device has one;
   - nothing is hovered after a tap.
4. **A finger moves nothing on the board**, on any touch screen: no point, circle or note is dragged
   by one, so the lock never lets go there. On a phone the lock is not shown.
5. **A touch on the board is the board's alone.** The browser's own handling of it is cancelled
   (`touchstart`), so that iOS selects no text under a held finger (the menu opens there) and
   offers no image of the canvas; the board, its cards and the menu are not selectable. A field
   being typed in loses the focus to a tap on the board, as it would to a press anywhere else.

### The page

6. **The bar**: Back, the project's name, the build status, the people on the board, search and ⋯.
   The search field is narrow and takes the whole bar while it is used; fields are 16 px, which keeps
   iOS from zooming into them.
7. **⋯ holds the rest of the bar** (the owner's choice of 2026-10-14: one menu), each item pressing
   the button it stands for, in this order:
   - **the modes** (the owner's choice of 2026-10-14), under "Mode · what a tap selects": Selection,
     Rests on's three steps under its name, Used by; each with a few words on what a tap selects,
     as a phone has no hover to say it, and the one in use ticked;
   - Share, the library, Export, Activity, the reader's name, help.

   Activity's count of what is new shows on ⋯ too.
8. **The bottom of the screen**: the legend at the left, the zoom's box at the right with fit and
   its ⋯ (edges, the linear form, the theme), which opens upwards. No zoom buttons: fingers zoom.
9. **The side panel is a drawer from ☰**, from the left, over a shade. It closes on a press outside
   it, on Esc, and when the reader goes somewhere from it (a target, a cluster's name); an arrow
   opens or folds a level and the drawer stays. Rows are 40 px. ⚙ Board and Trusted take the
   drawer's place, with a row at their top that goes back to it. Hiding a level is not offered.
10. **The panel is a sheet from the bottom** (the owner's choice of 2026-10-14). It opens at half the
    screen (55 %); a tap on its handle, its top 34 px, gives it the whole screen (92 %) or half of
    it again (the owner's choice: a tap, not a drag); ✕ closes it. The board is framed in the room
    above it. At its tallest the sheet stops under the bar, and the bar is over it, so that what
    opens from the bar (⋯, the search's results, Share) opens over the sheet.
11. **Under the view bar**, across the screen: the review strip (or the note of a view kept at a
    past build), then the selection bar.
12. **What takes the whole screen**: a declaration's source, its title bar its name (over as many
    lines as it needs) and ✕, without its namespace, place or collapse; Activity and the
    lost-and-found (the owner's choice of 2026-10-14), from the right, which close when the reader
    goes somewhere from them; the help.
13. **No pinned windows** (the owner's choice of 2026-10-14): the menu has no "Open in a pinned
    window" and the source window no pin. The menus show no keys beside their items.
14. **The Time Machine** keeps its clock, its ruler, the build's date and ✕ in its bar; keeping a
    build or saving it as a view arranges the board, and is left to a larger screen. The focus
    gives way to it.
15. **The help** (`?` in ⋯) holds the tips that fit a phone (GuideSpec decision 10), and lists the
    gestures and the page's places instead of the keys (`web/src/guide.ts`).

### Tall screens (the owner's decision of 2026-10-17)

16. **A tall screen is wider than a phone, at least 1.2 times as high as it is wide, and under a
    finger or narrower than 1000 px** (the owner's choice of 2026-10-18; `TALL` in
    `web/src/phone.ts`, `(min-width: 641px) and (max-aspect-ratio: 5/6) and (pointer: coarse),
    (min-width: 641px) and (max-width: 999px) and (max-aspect-ratio: 5/6)`; the block of that query
    in `web/style.css`): an iPad held upright (768 × 1024 to 1024 × 1366), a narrow window. The
    primary pointer tells it from an upright monitor (decision 29): a finger gets this page whatever
    the width, a mouse below 1000 px; what a finger changes is decisions 3–5's, on any touch screen.
    A screen nearer to square is a larger screen's page: the side panel and the panel leave its
    board room enough beside them.
17. **The page follows the screen as it turns** or as the window is resized across a line (as
    decision 2's): at once, nothing reloaded and nothing chosen lost — the selection, what the panel
    shows, the windows, the camera — the board framed again in its new room. The drawer closes where
    the shape has none; the sheet keeps its share of the screen.
18. **A tall screen is a larger screen's page** (not decision 1's phone): the bar with every button,
    the view bar with the modes, every popover, window, key and menu, arranging the board. Only where
    things sit changes, and the phone's own mechanisms place them — the drawer (decision 9) and the
    sheet (decision 10), never a third implementation; nothing a phone leaves out is left out.
19. **The side panel is the drawer from ☰**, at the left of the view bar, at most 360 px wide (60 %
    of the screen): it closes on a press outside it, on Esc, and when the reader goes somewhere from
    it, and ⚙ Board and Trusted take its place with a row back to it (decision 9). The board has the
    screen's whole width.
20. **The panel is a sheet from the bottom**, across the screen less the page's margin, its corners
    round. It opens at half the screen. Its handle sets its height: a drag, anywhere between a third
    of the screen and the tallest, under what goes across under the view bar (decision 22); a tap,
    half the screen or the tallest. The
    height is kept, as a share of the screen, while the page is open. The board's room is above it.
    What takes the panel's place on a larger screen takes the sheet's, at its height: Activity, the
    lost-and-found, and Export's window, the outline it arranges above it.
21. **The floating windows dock in the sheet's place** — the source windows, the reference window,
    the conversation window: over the panel, at the sheet's height, side by side where the
    screen is 960 px wide or more and one over the other below that, the declaration's source first.
    The dock places them: no edge resizes one and no drag moves one; its handle, above them, sets its
    height as the sheet's does (the same height). A collapsed window is its pill, at the dock's foot.
    The panel shows again as the last window closes or collapses; the board's room is above the dock.
22. **Under the view bar, across the screen: the review strip, then the selection bar** (decision
    11's order), so that neither covers the other nor the board.
23. **The legend and the zoom's box keep to the foot of the board's room**: at its left and right,
    above the sheet or the dock while one is open, at the screen's foot otherwise; where the sheet
    at its tallest leaves the board no room, they wait under it. The welcome card, What's new and
    the following strip sit just above them.
24. **The bar holds its buttons in the screen's width**: below 900 px, Share, the library and Export
    show their icons alone, with their titles; below 1000 px, the focus gives way to the Time
    Machine's bar while it is open, as on a phone (decision 14).
25. **The bar's popovers open at its right, under it** (Share, the library, the name's menu, help's
    menu): never past the screen's edge. The view bar's menus (Views, the focus) open under their
    buttons, as on a larger screen.
26. **The help** is as wide as the screen less its margin: the film over its chapters, as on a
    phone, then the tips; ⤢ as on a larger screen (GuideSpec decision 5).
27. **The tour and the tips in place are a larger screen's** (GuideSpec): their spotlight frames the
    board's room above the sheet, under the selection bar.
28. **The Time Machine** is a larger screen's (HistorySpec), its bar in the view bar (decision 24).

### Upright monitors (the owner's choice of 2026-10-18)

29. **An upright monitor is at least 1000 px wide and 1.2 times as high as it is wide, under a
    mouse** (`MONITOR` in `web/src/phone.ts`, `(min-width: 1000px) and (max-aspect-ratio: 5/6) and
    (pointer: fine)`; the block of that query in `web/style.css`): a monitor turned on its side,
    1080 × 1920 to 2160 × 3840, used with a mouse, with room. It is not a phone's page: no drawer
    and no sheet (decisions 9, 10). Upright with no pointer at all, a screen has a larger screen's
    page.
30. **It is a larger screen's page, its height used**: the bar, the view bar with the modes and the
    selection bar under them, every popover, hover card, menu and key; Tips, Export's window (the
    outline drawn on the board), the linear form, the Time Machine and the tour as on a larger
    screen, the tour's spotlight framing the board's room. The review strip stands at the board's
    top left; the legend and the zoom's box at the foot of the board's room.
31. **The page follows the screen as it turns** or as the window is resized across a line (as
    decision 17's): at once, nothing reloaded and nothing chosen lost. Off a monitor the windows go
    back to their own places; on one they go into the column (decision 34). The sizes the reader
    set (decision 35) are kept in this browser.
32. **The board is above, the side panel at its left**, from the view bar down to the work area;
    ⚙ Board and Trusted open beside it, as on a larger screen.
33. **A work area runs across the bottom while something is in it**: half the screen's height to
    start; nothing in it, the board has the whole height. The panel is a pane at its left, 30 % of
    the screen's width (380 to 640 px) beside the windows, the work area's whole width alone;
    Activity and the lost-and-found take the panel's place.
34. **The windows are one column at the panel's right, stacked from the top**: the source windows,
    then the reference window, then the conversation window. One alone takes the column's
    height; several share it, the reference the largest share (3 to the source's and the
    conversation's 2 each), as a page of a PDF is read best tall. With no declaration selected the
    column takes the work area's width. A collapsed window is its pill at the column's foot, or at
    the screen's when nothing else is open.
35. **Splitters set the parts' sizes, as a mouse does**: one above the work area (the board keeping
    420 px, the work area a quarter of the screen at least), one between the panel and the column
    (the panel 320 px at least, the column 360), one between each two windows of the column (140 px
    each at least). A double-click gives what a splitter sets its own size again; this browser
    keeps what the reader set. The column places the windows: no drag moves one and no edge resizes
    one.

## Open

- **Arranging from the menu.** A finger held on the board still offers what arranges it: Fold, Hide
  this level, Add a note here, and ⚙ Board's Re-layout. Whether a phone keeps them is the owner's
  call (decision 1 suggests not).
- **The mode in use** shows only in ⋯ (decision 7). A mark of it on the screen, if a reader loses
  track of it.
- **Not yet made for a phone**: the conversation window, the linear form and the artwork's frame.
  (The tour has a phone's own since 0.4: GuideSpec decision 4.)
- **A tall screen's panel in two columns**: on a sheet 900 px wide or more, the declaration's head,
  statement and review at the left, its counts, axioms and TCB at the right.
- **Export's window on an upright monitor**: in the work area, as a pane, rather than over the board
  at its top right.
- **A narrow window held sideways** (641–900 px wide, less than 1.2 times as high): the side panel
  is hidden there with no drawer to open it, and the panel covers the board. The drawer and the
  sheet would serve it as they serve a tall screen.
