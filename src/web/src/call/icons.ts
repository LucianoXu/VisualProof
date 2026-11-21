// The call's icons (CallSpec, "The page"), drawn as the page's own are: 16 units square, a stroke of
// the text's colour. Plain strings: the page's bundle and the call's both draw them.

const svg = (body: string, size = 16) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const PATHS = {
  call: `<rect x="1.8" y="4.2" width="8.6" height="7.6" rx="1.6"/><path d="M10.4 7.1 14.2 5v6l-3.8-2.1"/>`,
  camOff: `<rect x="1.8" y="4.2" width="8.6" height="7.6" rx="1.6"/><path d="M10.4 7.1 14.2 5v6l-3.8-2.1M2 2l12 12"/>`,
  mic: `<rect x="6" y="1.8" width="4" height="7.6" rx="2"/><path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2"/>`,
  micOff: `<rect x="6" y="1.8" width="4" height="7.6" rx="2"/><path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2M2.2 2.2l11.6 11.6"/>`,
  screen: `<rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.4"/><path d="M5.5 14h5M8 11.2V14M8 9V5M6.2 6.6 8 4.8l1.8 1.8"/>`,
  hand: `<path d="M5.2 8.2V3.6a1 1 0 0 1 2 0v3.8M7.2 7V2.6a1 1 0 0 1 2 0V7M9.2 7.2V3.6a1 1 0 0 1 2 0v5.2M11.2 6.4a1 1 0 0 1 2 0v2.4c0 3-2 5.2-4.8 5.2-1.7 0-2.8-.8-3.8-2.3L3 9.4a1 1 0 0 1 1.6-1.1l.6.8"/>`,
  smile: `<circle cx="8" cy="8" r="6.2"/><path d="M5.4 9.4c.6 1 1.5 1.5 2.6 1.5s2-.5 2.6-1.5M6 6.3h.01M10 6.3h.01"/>`,
  people: `<circle cx="6" cy="5.4" r="2.3"/><path d="M1.8 13.4c.5-2.5 2.1-3.7 4.2-3.7s3.7 1.2 4.2 3.7M10.6 3.4a2.2 2.2 0 0 1 0 4.2M11.8 9.8c1.3.4 2.1 1.6 2.4 3.4"/>`,
  layout: `<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.4"/><path d="M9.6 2.6v10.8M9.6 8h4.6"/>`,
  leave: `<path d="M2.2 9.6c3.4-3 8.2-3 11.6 0l-1.3 1.9-2.4-.9V8.9a7.6 7.6 0 0 0-4.2 0v1.7l-2.4.9z"/>`,
  up: `<path d="M4.5 9.8 8 6.3l3.5 3.5"/>`,
  more: `<circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/>`,
  pin: `<path d="M9.8 2.2 13.8 6.2l-2 .6-2.6 2.6.2 2.8-1 1-2.4-2.4-3.2 3.2M5.2 9.2 2.8 6.8l1-1 2.8.2L9.2 3.4z"/>`,
  follow: `<path d="M1.6 8s2.4-4.4 6.4-4.4S14.4 8 14.4 8 12 12.4 8 12.4 1.6 8 1.6 8z"/><circle cx="8" cy="8" r="1.9"/>`,
  link: `<path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>`,
  max: `<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>`,
  restore: `<path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"/>`,
  weak: `<path d="M3 12.5v-1M6.3 12.5v-3M9.7 12.5V7.6M13 12.5V5" opacity=".9"/>`,
  pip: `<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.4"/><rect x="8" y="8" width="5" height="3.6" rx=".6" fill="currentColor" stroke="none"/>`,
} as const;

export type CallIcon = keyof typeof PATHS;

export const callIcon = (name: CallIcon, size = 16): string => svg(PATHS[name], size);
