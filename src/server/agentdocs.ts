// The agents' documentation (docs/agent-api/): an index, README.md — the rules and the topics — and
// one Markdown file per topic, served as GET /api/agent/docs and GET /api/agent/docs/<topic>
// (server/agententry.ts), and by the MCP server as its docs tool and its resources. The topics below are
// what the entry, the docs tool and the resources name; a test keeps them and the folder the same.

import { readFileSync } from "node:fs";

/** the documentation, beside the server */
const DOCS_DIR = new URL("../../docs/agent-api/", import.meta.url);

export interface DocTopic {
  /** its file's name without .md, and its URL's last part */
  topic: string;
  title: string;
  /** what it covers, in a few words */
  about: string;
}

/** The topics, in the order a newcomer reads them. */
export const DOC_TOPICS: readonly DocTopic[] = [
  { topic: "requests", title: "Requests, answers and tokens", about: "headers, tokens, errors, the entry, every endpoint" },
  { topic: "words", title: "Words", about: "declaration, unit, TCB, trusted, review order, status, key" },
  { topic: "reading", title: "Reading declarations", about: "search, declaration, source, context, module, Lean" },
  { topic: "tcb", title: "Targets and their TCB", about: "targets, review sets, keys, why, uses; marks, trust" },
  { topic: "advice", title: "Advice and the pre-review", about: "opinions, comments, a pre-review step by step" },
  { topic: "notes", title: "Notes", about: "notes on the boards" },
  { topic: "following", title: "Following", about: "where people are, your view, links to it, what people see" },
  { topic: "views", title: "Views and the layout", about: "queries, views, places, pins" },
  { topic: "library", title: "The library and links", about: "papers and images, their pages, links to them" },
  { topic: "export", title: "Exported documents", about: "a view's document, typeset; a picture" },
  { topic: "history", title: "History and activity", about: "the timeline, builds, renames, the lost-and-found" },
  { topic: "talking", title: "Talking with people", about: "your inbox, replies, your state" },
  { topic: "mcp", title: "VisualProof's MCP server", about: "installing it, its tools and their actions" },
];

/** A topic's Markdown (null: the index), or null where there is no such topic or no file. */
export function readDoc(topic: string | null): string | null {
  const file = topic === null ? "README" : DOC_TOPICS.some((t) => t.topic === topic) ? topic : null;
  if (!file) return null;
  try {
    return readFileSync(new URL(`${file}.md`, DOCS_DIR), "utf8");
  } catch {
    return null;
  }
}
