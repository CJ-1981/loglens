# LogLens — Architecture

Reference for the current (as-built) architecture and the **simplification redesign** proposal.
LogLens is a single HTML file (`loglens.html`): no server, no build step, no dependencies.
Everything below runs client-side; log files never leave the machine except through the two
explicitly opt-in network paths (deep scan, AI wizard).

---

## 1 · Current architecture (as-built)

```mermaid
flowchart LR
    subgraph UI["UI surfaces (4 tabs + cards)"]
        WB["Workbench tab<br/>1 load files · 2 filter · 3 run<br/>+ results cards (overview · matches · export)"]
        VW["Viewer tab<br/>virtualized log reader"]
        MS["Search tab<br/>multi-file regex search"]
        PII["PII scan tab<br/>regex audit + deep scan"]
        ADV["Advanced (collapsible)<br/>sanitize copy · AI rule wizard"]
    end

    subgraph CORE["CORE (pure JS, fully unit-tested)"]
        PARSE["parseHeader<br/>logcat/syslog/ISO/CLF detection"]
        TS["timestamp detect + buckets"]
        MASK["compile() + maskLine()<br/>PII mask rules"]
        SCAN["scan driver<br/>filters, context lines, caps"]
        SRCH["search driver<br/>byte offsets, fair-share cap"]
        PIID["pii + deep-scan drivers<br/>masked reservoir sampling"]
    end

    subgraph IO["I/O & persistence"]
        FS["File / Blob API<br/>any size, streamed"]
        OPFS["stream export<br/>showSaveFilePicker"]
        LS["localStorage<br/>profiles · prefs · bookmarks"]
    end

    NET["opt-in network<br/>AI endpoint / presidio bridge<br/>(optional local cors_proxy.js relay)"]

    WB --> PARSE & TS & MASK & SCAN
    MS --> SRCH
    PII --> PIID
    VW --> PARSE & MASK
    ADV --> MASK
    SCAN --> FS
    SRCH --> FS
    PIID --> FS
    VW --> FS
    WB --> OPFS
    ADV --> NET
    PII --> NET
    CORE --> LS
```

### The viewer engine (the most load-bearing piece)

```mermaid
flowchart TB
    subgraph VW["Viewer: byte-window virtualization"]
        direction TB
        OPEN["vOpen(file)"] --> WIN["vWindow(anchor, dir)<br/>reads ~900-line window at byte offset"]
        WIN --> R["vRender()<br/>rows = tr.vrow, data-byte ids,<br/>level-filter skip, collapse, marks"]
        R --> SCROLL{"scroll / wheel / rail"}
        SCROLL -->|near bottom| CF["vChainForward()<br/>append chunk, trim top,<br/>byte-anchored restore"]
        SCROLL-->|near top| CB["vChainBackward()<br/>prepend chunk, trim tail"]
        CF & CB --> R
        SEEK["vSeekTo(byte)<br/>search jump · rail · go-to-time<br/>bookmark · boot boundary"] --> WIN
    end
```

Key invariants (all covered by the 9 unit suites + 2 Playwright E2E files):

- every line's byte length is exact UTF-8, so paging never duplicates or skips lines
- scroll anchors are **byte identities** (`data-byte`), immune to level filtering and buffer trims
- the four window arrays (`lines/disp/hdr/blen`) always change together (`vStateSane` guard)
- hidden tab ⇒ zero geometry ⇒ chaining disabled (no background scroll drift)

---

## 2 · Redesign goal: simplicity

User-facing problem today: **four tabs + a stepper + a collapsible advanced area = too many
mental places**. The pipeline steps are clear, but the relationship between the workbench
results, the search tab, and the viewer must be learned. Two search implementations
(viewer scan vs. multi-file search) and two results tables exist for historical reasons.

### Proposed information architecture — three surfaces, one engine

```mermaid
flowchart LR
    subgraph S1["1 · OPEN (files)"]
        F["drop / browse / folder<br/>file list + health (format, size, ts range)"]
    end
    subgraph S2["2 · FIND (search everywhere)"]
        Q["one search box<br/>rules + plain regex + level chips<br/>one results table (all files)"]
    end
    subgraph S3["3 · READ (viewer)"]
        V["the current viewer<br/>level chips · Δt · collapse · bookmarks"]
    end

    F --> Q -->|"click a match"| V
    V -->|"refine / new search"| Q
    F -->|"mask / sanitize / export"| EXP["Export panel<br/>(one card, all outputs)"]

    subgraph GEAR["⚙ gear (progressive disclosure)"]
        AI["AI wizard"]
        DEEP["deep scan (presidio / LLM)"]
        THEME["themes · fonts"]
    end
    GEAR -.-> S1 & S2 & S3
```

### Target component structure (refactor, no behavior change to the engine)

```mermaid
flowchart TB
    subgraph APP["app state (single source of truth)"]
        ST["session = { files, query, view }<br/>one reactive store replaces<br/>S + V + MS + DS globals"]
    end
    subgraph ENGINE["query engine (unified)"]
        QE["find(files, query, opts)<br/>ONE driver for workbench scan,<br/>viewer scan and multi-file search<br/>(worker-offloaded, streaming)"]
    end
    subgraph SURFACES["render surfaces (thin)"]
        FV["files view"]
        QV["results view"]
        VV["viewer view (byte-window core, unchanged)"]
    end
    ST --> QE
    QE --> QV
    ST --> FV & VV
```

### Simplification moves, ranked

| # | Move | Removes | Risk |
|---|------|---------|------|
| 1 | Merge **Search tab** into the workbench results (one search box above the results table; the viewer's in-view search becomes the same component scoped to the window) | 1 tab, 1 results table, 1 of the 2 scan drivers | medium — unify caps/context semantics first |
| 2 | Promote **viewer + search** to the primary flow; the workbench stepper becomes a 3-step wizard (open → find → read) shown only when no files are open | stepper bar, empty-state confusion | low |
| 3 | Fold **PII scan** into an "audit" panel of the export card (it produces mask rules — same destination) | 1 tab | low |
| 4 | One **⚙ gear menu** for AI wizard, deep scan, themes (currently scattered across advanced + toolbar) | advanced `<details>`, toolbar clutter | low |
| 5 | Single **export card**: extract / masked copy / stats / csv already exist — group + dedupe their options | scattered buttons | low |
| 6 | Unify persisted settings under one versioned profile object (today: ~15 localStorage keys) | key sprawl, no import/export of settings | medium — needs migration |

Non-goals: the byte-window viewer engine, the mask-rule compiler, and the streaming export
stay exactly as they are — they are the parts that make multi-GB logs work and are fully tested.

---

## 3 · Testing architecture (unchanged by the redesign)

```mermaid
flowchart LR
    A["9 node suites<br/>~480 assertions<br/>CORE + DOM stubs"] --> CI["CI (GitHub Actions)"]
    B["e2e/loglens.e2e.js<br/>57 checks, real Chromium"] --> CI
    C["e2e/loglens.viewer.e2e.js<br/>64 checks incl. computed dark colors"] --> CI
    CI --> PAGES["GitHub Pages live demo"]
```

Rule of thumb for the redesign: **every simplification move must keep the suites green** —
they encode the behavioral contract (red/green proofs live in the E2E for scrolling anchors,
level-filter jumps, and the dark theme).
