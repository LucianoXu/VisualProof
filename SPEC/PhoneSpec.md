# VisualProof Phone Spec

The page on a phone, beyond SPEC.md ("Deployment": "The website also supports small touch devices. On
small screens it can have a UI focused on reading and reviewing."). How the board itself looks and
behaves: CanvasSpec.md. Tablets such as the iPad are to be discussed (SPEC.md), and nothing here
decides them.

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
15. **The help** (`?` in ⋯) lists the gestures and the page's places instead of the keys
    (`web/src/guide.ts`).

## Open

- **Arranging from the menu.** A finger held on the board still offers what arranges it: Fold, Hide
  this level, Add a note here, and ⚙ Board's Re-layout. Whether a phone keeps them is the owner's
  call (decision 1 suggests not).
- **The mode in use** shows only in ⋯ (decision 7). A mark of it on the screen, if a reader loses
  track of it.
- **Not yet made for a phone**: the tour, the conversation window, the linear form and the
  artwork's frame.
