// The mark of an agent (AgentSpec decision 1): a small robot wherever the page names one — its
// initials among the others, its advice in the review, what it did in Activity — so that nothing
// an agent said or did reads as a person's.

/** A robot's head, drawn in the colour of the text around it. */
export const BOT =
  `<svg class="bot" viewBox="0 0 16 16" aria-hidden="true">` +
  `<path d="M8 4.2V2.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
  `<circle cx="8" cy="1.9" r="1.1" fill="currentColor"/>` +
  `<rect x="2.2" y="4.4" width="11.6" height="9.2" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
  `<circle cx="5.9" cy="8.8" r="1.25" fill="currentColor"/><circle cx="10.1" cy="8.8" r="1.25" fill="currentColor"/>` +
  `</svg>`;

/** How an agent is named in words: "Claude (agent)". */
export function agentName(name: string): string {
  return `${name} (agent)`;
}
