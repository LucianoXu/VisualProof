# VisualProof Tool Spec

*This is the human-maintained top SPEC. All other specifications support details.*

The reliability of a formal proof splits into two parts: the encoding of the problem should be honest, and the reasoning should be logical. Interactive theorem provers solve the second part, and people still need to check the first part manually.

VisualProof is a tool that improves the procedure, which helps to visualize the dependency, identify the boundary of trusted code, and check the TCB of a lean proof. It supports realtime group collaboration, and keeps an audit record. 
VisualProof can export a nicely typeset PDF document for the formalization and audit. It has AI agent support, an informative help with tutorial and tips. It also has aesthetic value in the visualization and has a mode to render beautiful artworks.


## Deployment

- This tool should support both Linux and macOS. 
- This tool is provided as a npm package. It is opensource software on GitHub, with a introduction webpage.
- This tool can serve a website that visualizes a local Lean codebase, both viewed locally or deployed on a server.
- Websites served by this tool will check for updates periodically, and seamlessly update.


## Features

- The website reflects the changes reactively at realtime.
- The website reflects the compilation status of the whole Lean codebase at file-level granularity.
- The operation on VisualProof canvas will not change lean code state. So only the owner of codebase controls modification and compilation. No .lake conflict.
- The data of website and lean build is preserved in the site directory and the cache directory, not in the codebase.


### Canvas

- The website visualizes the structure of all terms in the codebase as a graph. Nodes represent terms (defs, theorems, namespaces) and edges represent dependency. Nodes are clustered according to namespace / file structures. Namespaces can be toggled to expanded/folded. Folded namespaces are shown as single nodes.
- The website has different palettes for rendering the node. Each palette shows the status of one perspective, like the type of formal term, or the compilation/investigation status.
- The default arrangement of node follows the dependency relation: low-level terms lives below the high-level terms in general.
- The nodes have descriptive information from the leanfile or the compiled .lake file, e.g., definitions, comments, type hints and syntax highlights.
- With node selection on the website, the user can open the source code with Lean hover hint.
- The nodes can be dragged and pinned to a certain place in the canvas. The visual behavior is visible to all users.


### View

- The website uses views to display part of the formalization. Views can be created, modified or deleted.
- The view functionality is supported by two mechanisms: a filter of nodes, and a record of invisible clusters.
- The website support multi-selection, and the tool provides different selection modes, which further interact with operating the view.
- Upon selecting one node, the canvas respond differently according to the mode. Modes should include `Selection`, `Rests on` (uses, TCB, keys), and `used by`.


### Review

- The website allows users to comment and approve the Lean terms.
- Users can mark target terms. For each target term, users can mark the key formal terms for the target.


### Collaboration

- The website serves as a platform for realtime collaboration, like a shared whiteboard.
- Users can share the website with a sharing link. The sharing link is guarded by an access token.
- Users can also create a sharing link with readonly access. Guests with readonly access are not visible to others. Guests with readonly access can only create readonly sharing link. Readonly sharing link can be access-token-free.
- Users can follow other user's camera on the website.
- The website maintains a log of activity that is visible to all users.

### Attachment

- The website allows users to create items including text notes, and PDF or picture attachments. Items can be placed on the canvas, anchored to nodes and linked to formal terms.
- The website embeds a PDF viewer.


### Export

- Users can can export an PDF document of the current view. The view itself also serves as an outline of the document.
- When exporting the PDF document, the canvas will temporarily switch to the linear form to show the outline order. In the linear form all terms and clusters align on one vertical line.
- The website provides the functionality to output an artwork of the visualization. It provides a mode where users can further finetune the appearance and get high-quality image rendering output.


### Agent

- Users can share the website to an AI agent and let them login. Users can talk to the AI agents. AI agents can help with the operation on the website (except approving formal terms).


### History

- The website has the TimeMachine functionality to keep linear track of the history of the codebase. This part is similar to git.


### Definition of TCB

We calculate the TCB terms according to the code structure, not the constructed Lean terms.

The TCB of a theorem includes:
- All definitions/structures/inductive types/instances starting from the theorem statement.
- All axioms used in the statement and proof.
- Meta-programming of the notations.

The TCB of a theorem excludes:
- Terms only used by the proofs (also, the unique instances of class type).
- Lean kernel and toolchain.
- External libraries of the codebase (e.g., Mathlib).


## Design Language

We use Apple-style minimalism / Gradient typography. Windows and panels have rounded corners and elegant shadows. The website provides both light/dark themes. The theme colors are white, black and light purple.

Keep the UI clean and visually appealing, and give users a clear sense of control. Keep explanations brief and only include what’s necessary.


## Tips

- The website provides a tutorial of basic usage, and tips for advanced techniques.

We use the Apple-style tips as the main documentation. It has a static/dynamic visual demonstration of the use case, with a concise description on the functionality or operation.
