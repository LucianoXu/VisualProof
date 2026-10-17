// What storyboards share.

/** A declaration found by the search and selected: `/`, its name typed, the list shown a moment,
 *  Enter (the first hit). The board stays the one shown. */
export const SEARCH = (query) => [
  { key: "/", cap: "/", ms: 300 },
  { type: query, ms: 700 },
  { key: "Enter", cap: "↵", ms: 1200 },
];
