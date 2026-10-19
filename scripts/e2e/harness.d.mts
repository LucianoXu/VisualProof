// The types of scripts/e2e/harness.mjs, for the test that keeps it out of the repository and real
// sites, and for a scenario's editor.

export const REPO: string;

/** How a page is looked at. */
export interface Look {
  theme?: "light" | "dark";
  screen?: "desktop" | "phone";
}

export const SCREENS: Record<"desktop" | "phone", Record<string, unknown>>;

export function within(p: string, dir: string): boolean;
export function refused(dir: string, homes?: { data: string; cache: string }): string | null;
export function scratch(name: string): string;
export function shotName(n: number, look: Required<Look>, who: string, what: string): string;
export function freePort(): Promise<number>;

export interface Answer {
  status: number;
  json: any;
  text?: string;
}

export interface Agent {
  token: string;
  id: string;
  name: string;
  level: "read" | "advise" | "full";
  prompt: string;
  ask(method: string, path: string, body?: unknown): Promise<Answer>;
}

export interface Server {
  url: string;
  port: number;
  key: string | null;
  public: boolean;
  pid: number;
  dir: string;
  site: string;
  cache: string;
  log: string;
  root: string;
  links: Map<string, string>;
  ask(method: string, path: string, body?: unknown, name?: string): Promise<Answer>;
  ready(o?: { usage?: boolean; ms?: number }): Promise<any>;
  agent(o?: { level?: "read" | "advise" | "full"; name?: string; by?: string }): Promise<Agent>;
  stop(ms?: number): Promise<{ code: number | null; signal: string | null }>;
}

export function serve(o: {
  project: string;
  showcase?: string;
  dir?: string;
  cache?: string;
  key?: boolean;
  public?: boolean;
  publicUrl?: string;
  agents?: "read" | "advise" | "full";
  port?: number;
  args?: string[];
}): Promise<Server>;

export interface Person {
  name: string;
  kind: "guest" | "invited" | "reader" | "visitor";
  look: Required<Look>;
  ctx: any;
  page: any;
  errors: string[];
  open(path?: string): Promise<void>;
  ready(o?: { ms?: number; settle?: number }): Promise<void>;
  ask(method: string, path: string, body?: unknown): Promise<Answer>;
  close(): Promise<void>;
}

export function browser(o?: { headed?: boolean }): Promise<any>;
export function camera(dir: string): { dir: string; taken: string[]; shot(person: Person, what: string): Promise<string> };
export function guest(b: any, server: Server, name: string, look?: Look): Promise<Person>;
export function invited(b: any, server: Server, name: string, look?: Look, o?: { by?: string }): Promise<Person>;
export function reader(b: any, server: Server, look?: Look, o?: { by?: string; name?: string }): Promise<Person>;
export function visitor(b: any, server: Server, look?: Look, o?: { name?: string }): Promise<Person>;
export function report(dir: string): { say(...a: unknown[]): void; check(ok: boolean, what: string): boolean; finish(people?: Person[]): number };
