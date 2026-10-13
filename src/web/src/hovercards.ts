// Hover cards, as VS Code shows them: a card for what the pointer rests on, which the pointer can
// move onto; resting on a name inside a card opens another card for that name beside it, and so
// on; a click on a name goes to its declaration. A card closes a moment after the pointer has
// left it for anything but a card nested in it, so moving onto a card never loses it.

/** how long the pointer may be away before cards close, and rest on a name before one opens */
const GRACE_MS = 350;
const OPEN_MS = 280;

/** A card: what can be shown at once, and what replaces it when it comes (Lean's answer). */
export interface Card {
  html: string | null;
  more?: Promise<string | null>;
}

export interface CardHooks {
  /** the card for a name in a card, or null when there is nothing to say */
  card(name: string): Card | null;
  /** a name in a card was clicked */
  go(name: string): void;
}

export class HoverCards {
  private hooks: CardHooks;
  /** cards[k] is nested in cards[k - 1]; anchors[k] is what it was opened from */
  private cards: HTMLElement[] = [];
  private anchors: (Element | null)[] = [];
  /** the first card's place in the page: the pointer may stay there */
  private rootRect: DOMRect | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private closeFrom = Infinity;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private opening: Element | null = null;

  private onMove = (e: PointerEvent) => this.moved(e);
  private onClick = (e: MouseEvent) => {
    // a card of this window's: another window's cards are its own
    const card = (e.target as Element).closest?.<HTMLElement>(".hcard");
    if (!card || !this.cards.includes(card)) return;
    const ref = (e.target as Element).closest<HTMLElement>("[data-ref]");
    if (!ref) return;
    e.preventDefault();
    this.hide();
    this.hooks.go(ref.dataset.ref!);
  };

  constructor(hooks: CardHooks) {
    this.hooks = hooks;
    document.addEventListener("pointermove", this.onMove, { passive: true });
    document.addEventListener("click", this.onClick, true);
  }

  /** The window the cards are for has gone: they close, and listen no more. */
  dispose(): void {
    this.hide();
    document.removeEventListener("pointermove", this.onMove);
    document.removeEventListener("click", this.onClick, true);
  }

  get open(): boolean {
    return this.cards.length > 0;
  }

  /** The first card, for what lies in `at` (the word under the pointer); the cards that were
   *  open close. `subject`: the declaration it is about, whose name in it opens no other card. */
  show(html: string, at: DOMRect, subject: string | null = null): void {
    this.hide();
    this.rootRect = at;
    this.push(html, at, null, subject);
  }

  /** Close every card now. */
  hide(): void {
    this.clearClose();
    this.clearOpen();
    for (const c of this.cards) c.remove();
    this.cards = [];
    this.anchors = [];
    this.rootRect = null;
  }

  /** The pointer left what the first card is about: the cards close unless it reaches one. */
  leave(): void {
    if (this.cards.length) this.scheduleClose(0);
  }

  private push(html: string, at: DOMRect, anchor: Element | null, subject: string | null): HTMLElement {
    const level = this.cards.length;
    const el = document.createElement("div");
    el.className = "hcard";
    el.dataset.level = String(level);
    if (subject) el.dataset.subject = subject;
    el.style.zIndex = String(37 + level);
    el.innerHTML = html;
    document.body.appendChild(el);
    this.cards.push(el);
    this.anchors.push(anchor);
    this.place(el, at);
    return el;
  }

  /** Below what it is about, or above when there is no room below; never off the screen. */
  private place(el: HTMLElement, at: DOMRect): void {
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(at.left, innerWidth - w - 8));
    const below = at.bottom + 4;
    const top = below + h <= innerHeight - 8 ? below : Math.max(8, at.top - h - 4);
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /** Close the cards from `level` on. */
  private closeLevels(level: number): void {
    while (this.cards.length > level) {
      this.cards.pop()!.remove();
      this.anchors.pop();
    }
    if (!this.cards.length) this.rootRect = null;
  }

  private scheduleClose(level: number): void {
    if (this.closeTimer && this.closeFrom <= level) return;
    this.clearClose();
    this.closeFrom = level;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.closeFrom = Infinity;
      this.closeLevels(level);
    }, GRACE_MS);
  }

  private clearClose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.closeFrom = Infinity;
  }

  private clearOpen(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
    this.opening = null;
  }

  private moved(e: PointerEvent): void {
    if (!this.cards.length) return;
    const t = e.target as Element;
    // only this window's cards count: on another's, the pointer has left these
    const found = t.closest?.<HTMLElement>(".hcard") ?? null;
    const card = found && this.cards.includes(found) ? found : null;
    const level = card ? Number(card.dataset.level) : -1;
    if (level < 0) {
      this.clearOpen();
      // still on what the first card is about: it stays, the cards nested in it go
      const r = this.rootRect;
      const on = r && e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
      if (on) {
        if (this.closeFrom === 0) this.clearClose();
        if (this.cards.length > 1) this.scheduleClose(1);
      } else this.scheduleClose(0);
      return;
    }
    // on a card: it and the cards it is nested in stay
    if (this.closeFrom <= level) this.clearClose();
    const ref = t.closest?.<HTMLElement>("[data-ref]") ?? null;
    // the card's own subject goes there on a click, but opens no card about itself
    if (ref && card!.contains(ref) && ref.dataset.ref !== card!.dataset.subject) {
      if (this.anchors[level + 1] === ref) {
        // on the name whose card is open: that card stays too
        this.clearOpen();
        if (this.closeFrom === level + 1) this.clearClose();
        return;
      }
      if (this.opening === ref) return;
      this.clearOpen();
      this.opening = ref;
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        this.opening = null;
        if (!ref.isConnected) return;
        const name = ref.dataset.ref!;
        const c = this.hooks.card(name);
        this.closeLevels(level + 1);
        if (!c || (!c.html && !c.more)) return;
        const at = ref.getBoundingClientRect();
        const el = this.push(c.html ?? `<pre class="code">${name.replace(/[&<>]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[x]!)}</pre><div class="sw-tip-wait">Asking Lean…</div>`, at, ref, name);
        // Lean's own card, when it comes, replaces the graph's — if this card is still open
        void c.more?.then((html) => {
          if (!el.isConnected) return;
          if (html) el.innerHTML = html;
          else if (!c.html) return this.closeLevels(level + 1);
          else return;
          if (ref.isConnected) this.place(el, ref.getBoundingClientRect());
        });
      }, OPEN_MS);
    } else {
      this.clearOpen();
      if (this.cards.length > level + 1) this.scheduleClose(level + 1);
    }
  }
}
