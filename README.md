# LogLens — Log Extraction & PII Masking Dashboard

[![CI](https://github.com/CJ-1981/loglens/actions/workflows/ci.yml/badge.svg)](https://github.com/CJ-1981/loglens/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/live%20demo-try%20it-0f62fe)](https://cj-1981.github.io/loglens/)
![version](https://img.shields.io/badge/version-v1.18-blue)
![tests](https://img.shields.io/badge/assertions-375%20passing-green)

**Single-file, browser-based tool for log triage**: load huge log files (logcat, syslog, ISO-8601, Apache/CLF, or any line-based text), filter them with regex rules, mask personal data (VINs, emails, MACs, IPs…), analyze the results, and export sanitized extracts — all client-side, no server, files never leave the machine.

- **Try it live**: https://cj-1981.github.io/loglens/ — the whole tool is one HTML file, no install
- **File**: `loglens.html` (~190 KB, zero dependencies)
- **Open it**: double-click, or `start loglens.html` — works from any location, including network shares
- **Current version**: v1.18.2 · 375 automated assertions across 8 suites (`test_loglens.js` + `test_loglens_v15.js` + `test_viewer_ui.js` + `test_viewer_search.js` + `test_team_nav.js` + `test_team_denoise.js` + `test_team_workbench.js` + `test_team_marks.js`) · worker-accelerated scans · mobile-responsive

---

## Contents

1. [Quick start](#quick-start)
2. [Workbench layout](#workbench-layout)
3. [Input files](#1-input-files)
4. [Extraction rules](#2-extraction-rules)
5. [Masking rules](#3-masking-rules)
6. [Mask-only mode (sanitize a copy)](#3b-mask-only-mode)
7. [Running scans & outputs](#running-scans--outputs)
8. [Results & stats](#results--stats)
9. [Export](#export)
10. [AI rule wizard](#ai-rule-wizard)
11. [Display: fonts, logcat themes, dark mode](#display-options)
12. [Browser support](#browser-support)
13. [Privacy & security](#privacy--security)
14. [Performance & limits](#performance--limits)
15. [Log format assumptions](#log-format-assumptions)
16. [Keyboard & interaction reference](#keyboard--interaction-reference)
17. [Viewer tab](#viewer-tab-browse-the-full-log)
18. [PII scan tab](#pii-scan-tab)
19. [Relationship to scripted pipelines](#relationship-to-scripted-pipelines)
20. [Development & testing](#development--testing)
21. [Troubleshooting / FAQ](#troubleshooting--faq)
22. [Viewer roadmap](#viewer-roadmap-researched-not-yet-built)
23. [Changelog](#changelog)

---

## Quick start

1. Open `loglens.html` in **Edge or Chrome** (full feature set — see [browser support](#browser-support)).
2. Click **demo** (top right) to try everything without any files.
3. Or drop your `.log` files (or a whole folder) into **step 1 · input files**.
4. Set up **step 2 · filter** (level chips, include/exclude rules, time window, mask rules) — most controls re-run automatically.
5. Press **run** (step 3) — results appear below with stats, histogram, and a filterable table.
6. Browse in **step 4 · results**, export from **step 4 · export** — output is masked by default, `[Lnnn]` prefixes optional.

The default profile matches **all lines** with the default PII mask rules enabled — add include rules to filter down.

## Workbench layout

The workbench follows the triage pipeline, top to bottom. A **stepper bar** shows where you are and what's configured — click any step to jump to it:

| Step | Section | Status shown |
|---|---|---|
| **1 load files** | input files | files loaded |
| **2 filter** | extract rules + mask rules | include / exclude / mask rule counts |
| **3 run** | run bar (sticky) | readiness summary |
| **4 results** | overview · matches · export | match totals |
| **5 advanced** | sanitize copy · ai rule wizard (collapsed) | — |

The current step highlights as you scroll. Steps 4 and 5 appear/appear-expanded when relevant (results after the first run; the AI wizard opens itself when you generate or send to it).

## 1 · Input files

| Action | How |
|---|---|
| Add files | Drag & drop, or click the drop zone (multi-select) |
| Add a folder (recursive) | Drop a folder onto the zone, or **add folder** |
| Include/exclude per run | Checkbox on each file row |
| Remove | ✕ on the row |

- Files are **streamed line-by-line** — a 450 MB log scans the same way a 1 MB one does; the file is never loaded into memory as a whole.
- Duplicate files (same name + size) are ignored.
- Any text file works; `.log`/`.txt` extensions are picked up by folder-drop.

## 2 · Extraction rules

A line is **kept** when it matches any *include* rule and no *exclude* rule.

| Control | Notes |
|---|---|
| **Include / exclude rules** | Free-form regex per rule, with enable checkbox, **Aa** case toggle (default: case-insensitive), click the kind badge to flip include↔exclude. Rule edits mark settings stale — a `⚙ settings changed — press run` chip appears above the results |
| **No include rules at all** | = *match everything* (the mask-everything / full-copy use case) |
| **Presets** | Crash/ANR hunt · Connectivity triage · Auth/session issues — one click replaces the rule set |
| **Levels** | V/D/I/W/E/F chips. Narrowing the selection **re-runs the scan automatically** (debounced). Stack-trace/continuation lines inherit the level of the line they belong to — filtering E keeps an error's stack trace and drops debug chatter. Complete lines without a severity field (syslog/ISO/CLF) stay visible; header-less orphan lines are dropped only while a narrowed filter is active |
| **Time window** | `from` / `to` — **adapts to your logs**: the inputs sniff the loaded files and show the detected format's placeholder/hint (logcat, ISO 8601, syslog, Apache/CLF). Any supported form is accepted and normalized internally (`2026-08-24 15:37` ≡ `Aug 24 15:37` ≡ `08-24 15:37`); compare is **boundary-inclusive** (`to 19:22` keeps 19:22:59). Invalid input gets a red border. Changing the window re-runs automatically |
| **Context ± N** | grep `-A/-B` equivalent: keep N lines around each match — captures stack-trace lines that don't contain the keyword. Deduped; never crosses file boundaries; rows shown dimmed/italic. Changing N re-runs automatically |
| **Result cap** | Max records kept in memory for the table/CSV (default 200,000). Direct-to-file export is **uncapped**. Hitting the cap shows a warning banner and stamps the export header. Changing the cap re-runs automatically |
| **Error-ish tagging** | Toggle + editable regex (default: failure keywords). A kept line is error-ish if the regex matches **or** its level is E/W/F. Changing either re-runs automatically |

**Test rules against sample** (bottom of the section): paste lines or pull the first 20 lines of file 1, then **Test rules** — shows kept/total, per-rule hit counts, excluded count, and the kept lines. Catches bad regexes before a multi-GB scan.

## 3 · Masking rules

Ordered list of `name / pattern / replacement` rules applied to every kept line (and every line in mask-only mode).

- **Order matters** (specific before generic) — reorder with **↑ / ↓**.
- **Replacements** support `$1…$N` group refs and `$$` → literal `$`.
- **Aa** per-rule case toggle (mask rules default to **case-sensitive**; tick for insensitive).
- **Hits** column shows per-rule match counts after each run.
- **Live mask preview**: paste any line, watch it get masked instantly — before touching real data.
- Rule edits mark settings stale (chip above the results) — press **run** to apply them to the loaded files.

**Default PII presets** (16 rules, restore anytime via the button) — ordered, specific-first:

| Rule | Pattern → Replacement |
|---|---|
| VIN (17 chars) | any 17-char VIN-charset token → first 3 + `**********` + last 4 |
| IBAN | keeps country/check digits → `DE89**********` |
| credit card | 16 digits in 4-groups → `[card]` |
| SSN | `123-**-****` |
| phone (intl +) | keeps country code → `+45 ***` |
| phone (US paren) | `(555) ***-****` |
| IMEI (15 digits) | `[IMEI]` |
| email | `x***@***` |
| GNSS coordinates | decimal lat/lon pairs → first decimal kept |
| device serial | `SN-…` → `SN-***` |
| MAC (keeps OUI) | `aa:bb:cc:**:**:**` |
| private IPv4 | last octet → `.x` |
| IPv4 (any) | public addresses → last two octets `.x.x` |
| IPv6 link-local / ULA | → `IPv6-masked` |
| subscriberId | → `***` |
| hotspot SSID | `AndroidShare_****` |

Guarded against false positives: logcat timestamps (`08-24 15:37:01.123`), epoch-millis values (13 digits), timezone offsets (`+0200`) and 3-part version numbers are all left intact (regression-tested).

## 3b · Mask-only mode

The "sanitize this log before sharing" path: runs the mask rules over **every line** of the checked files and writes complete `<original>.masked.log` copies. No extraction rules, no cap, no prefixes. Lives under **step 5 · advanced**.

- **Chromium**: streams directly to disk — any file size, constant memory. Multi-file → pick an output folder, one masked copy per input.
- **Other browsers**: in-memory fallback, single file, practical up to ~1 GB.
- Optional **.gz** output (gzip on the fly).
- Summary reports lines processed, total replacements, per-rule coverage — and warns if nothing matched.

## Running scans & outputs

**run** (sticky bar, step 3) shows a live **readiness summary** (`1 file · 0 include · 0 exclude · 16 mask rules — ready`) and disables the button until files are loaded. Progress shows MB read, MB/s, ETA, lines, matches.

Two output modes:

| Mode | When | Behavior |
|---|---|---|
| In-memory | default | Results in the table/CSV, capped at *result cap*; download via Export section |
| **direct-to-file export** | checkbox in run bar | Every matched line is streamed to disk **during** the scan — uncapped, constant memory. 1 input → save-picker for one output; **N inputs → pick an output folder**, one `<name>.extract.log` per input (duplicate basenames auto-suffixed `_2`, empty outputs removed) |

Other run-bar controls: **Stop** (interrupts within ~8 MB), **Export/Import profile** (rule sets as JSON). The page warns before closing mid-scan.

Level chips, context ±, cap, err-ish and the time window **re-run automatically** after a completed scan (debounced). Include/exclude and mask-rule edits show the `⚙ settings changed — press run` chip instead — those can rescan hundreds of MB, so applying them is always an explicit click.

## Results & stats

- **Stat cards**: lines scanned, matched, error-ish, mask hits, context lines, run time.
- **Histogram**: matched lines per time bucket (bucket size auto-scales 1 min → 6 h). **Click any bar** to time-filter the scan to that window (auto re-runs).
- **Top tags** and **masking coverage** tables; **per-file breakdown** (lines / matched / err-ish / time span per input file).
- **Active-filter chips** above the results (`⏱ window ×`, `err-ish only ×`, `search ×`, `context ±N ×`, `⚙ settings changed`) — one click removes the filter or re-runs.
- **Results table**: level badges, error rows tinted, context rows dimmed; full line in the tooltip; **click a row to copy** the full masked line.
- Regex search box filters tag+message live; "Show more" appends rows incrementally (fast at 100k+ rows).

## Export

| Button | Format |
|---|---|
| Extract (.log) | masked lines, optional `[Lnnn]` prefix (per-file numbering; multi-file export gets a header listing the files) |
| Copy | same content to clipboard |
| Extract (.gz) | gzip-compressed extract (Chromium) |
| Stats (.json) | totals, levels, top tags, mask hits, buckets, per-file, full profile |
| Results (.csv) | one row per record; message capped at 1,000 chars (noted in tooltip) |

## AI rule wizard

Lives under **step 5 · advanced**. Describe what you want in plain language ("extract Bluetooth pairing failures, mask phone numbers, exclude HCI dumps") → a validated rule JSON comes back.

- **Any OpenAI-compatible endpoint**: base URL (`https://api.openai.com/v1`, GLM, Azure, Ollama, LM Studio, corporate proxies…) + API key + model. **Test connection** checks reachability/key.
- **Key handling**: sent only to the endpoint you configure; stored in `localStorage` *only* if you tick "remember key".
- **Grounding (recommended)**: paste 3–10 real sample lines so the model sees your format; optionally include your current rules for improve/extend workflows.
- **Safety**: responses are parsed defensively (fences/prose stripped) and every rule is **validated in-browser** — invalid regexes are reported and skipped, never applied. **Ctrl+Enter** generates.
- Apply (replace) / Append / Copy / Download the generated profile; profiles are portable with the manual import/export.
- The PII scan page can hand off to the wizard directly (**send to AI wizard**) — it opens this section, pre-fills the requirement with the findings summary, and pre-checks "send current rules".

> CORS: browsers can only call endpoints that allow cross-origin requests. Most cloud APIs and LM Studio do; for Ollama start it with `OLLAMA_ORIGINS=*`.

## Display options

- **UI theme**: 🌙 toggle, persisted, follows OS preference by default.
- **Font** (all monospace surfaces): Consolas, JetBrains Mono, Fira Code, Cascadia Code, IBM Plex Mono, Source Code Pro, Roboto Mono, Menlo/SF Mono, DejaVu, Courier New, System mono. Local-first font stacks; optional **webfonts (online)** checkbox fetches missing fonts from Google Fonts — unticked, the tool stays fully offline.
- **Viewer font size**: `A−` / `A+` in the viewer toolbar (persisted, 9–28 px).
- **Logcat theme** (results view): LogLens default · Android Studio · VS Code Dark+ · Dracula · Solarized Dark · High Contrast — each restyles the console surface, all six level colors, and error/context rows, independently of the UI theme.

## Browser support

| Feature | Chromium (Edge/Chrome) | Others (Firefox/Safari) |
|---|---|---|
| Core: scan, rules, masking, stats, in-memory export | ✅ | ✅ |
| Dark mode, fonts, logcat themes, filter chips, row-copy | ✅ | ✅ |
| Viewer: continuous scroll, match walking, collapse, gap scan, bookmarks, go-to-time, boots | ✅ | ✅ |
| Direct-to-file export + output-folder batches | ✅ | ❌ (in-memory only) |
| Folder drag-drop & recursive folder picker | ✅ | partial (multi-file drop works) |
| Gzip exports | ✅ | ❌ |
| AI wizard | endpoint-dependent | endpoint-dependent |

## Privacy & security

- **Everything runs locally**; logs are read via the streaming File APIs and never uploaded. The only outbound requests are the AI wizard (your configured endpoint, on demand) and optional Google-Fonts fetch.
- **Unmasked export is impossible by design**: raw lines are never stored — only masked copies exist in memory or in outputs. Viewer row-copy and bookmark export copy the masked text too.
- Rule fields, file names, and AI responses are HTML-escaped (incl. attribute contexts) before rendering.
- Rule profiles, theme, fonts, viewer font size, bookmarks (per file), and (opt-in) AI key persist in `localStorage` on this machine only.

## Performance & limits

- Throughput ≈ **80–100 MB/s** on a typical laptop (measured 600k lines / 57 MB in ~0.7 s); a 400 MB logcat scans in ~5–10 s.
- Memory is bounded by the result cap (200k records ≈ tens of MB), not by file size. Multi-GB files are safe in both scan modes.
- An 8 MB "newline valve" guards against pathologically long single lines.
- Time scales linearly with bytes; the only unbounded outputs are direct-to-file streams, which go straight to disk.
- Viewer scans (go-to-time bisection, boot scan, gap scan) are incremental window/stream reads — bounded work per press, cancelable.

## Log format assumptions

**Primary format** (Android logcat):
```
MM-DD HH:MM:SS.mmm  PID TID L TAG: message
```
- TAG may contain `:` (e.g. `MyApp:Sub`) — the separator is colon **+ space**.

**Timestamp auto-detection (v1.7)** — other common formats are detected and **normalized to the same `MM-DD HH:MM:SS.mmm` key**, so time filters, histogram, and time-span stats work on them too:

| Source format | Example | Normalized |
|---|---|---|
| ISO 8601 / SQL | `2026-08-24T15:37:01.123Z` or `2026-08-24 15:37:01` | `08-24 15:37:01.123` / `.000` |
| RFC3164 syslog | `Aug 24 15:37:01` (day may be single-digit) | `08-24 15:37:01.000` |
| Apache / CLF | `[24/Aug/2026:15:37:01 +00:00]` | `08-24 15:37:01.000` |
| Bare `MM-DD` | `08-24 15:37:01 app: started` | `08-24 15:37:01.000` |

Notes: years and timezone offsets are ignored (consistent with the logcat-style no-year model). In the workbench, lines with a detected timestamp but no logcat header have no level — they stay visible when you narrow the level chips (syslog-style logs remain usable), while header-less continuation lines inherit the previous line's level. Legacy `L/TAG(PID): message` lines parse for level/tag but have no timestamp.

For **any other text format** (JSON lines, CSV, custom app logs), extraction and masking work fully; only the timestamp-derived features (time window, histogram, Δt, go-to-time) are inert.

## Keyboard & interaction reference

| Input | Action |
|---|---|
| Click results row | copy full masked line |
| Click histogram bar | time-filter scan to that bucket |
| Click filter chip ✕ | remove that filter (re-runs if scan-time) |
| `Ctrl/⌘+Enter` (AI box) | generate rules |
| `Aa` on any rule | toggle case sensitivity |
| Kind badge (include/exclude) | click to flip |
| **viewer**: `PgUp`/`PgDn`, `↑`/`↓`, `Home`/`End` | page / line / file edges (mouse wheel scrolls continuously) |
| **viewer**: `/`, `Enter`/`n`, `Shift+Enter`/`N`, `Aa` | focus search, next / previous match, case toggle |
| **viewer**: `←`/`→` after a search | previous / next highlighted match (steps in view instantly, byte-scans past the edges) |
| **viewer**: drag left rail | jump by byte position (grab point preserved) |
| **viewer**: drag tag/message edge (double-click = auto-fit) | resize tag column |
| **viewer**: `wrap` toggle | long-line wrap on/off (off = one line per entry, horizontal scroll) |
| **viewer**: `A−`/`A+` | viewer font size (persisted) |
| **viewer**: `Δt` toggle | time-delta column on/off |
| **viewer**: `≡` toggle | collapse consecutive repeated lines (click `×N` badge to expand a run) |
| **viewer**: `gap»` | jump to the next ≥5 s silence |
| **viewer**: go-to-time box, `boots` + boot selector | jump to a timestamp / reboot boundary |
| **viewer**: `b` | bookmark the centered line (per-file, persisted) |
| **viewer**: bookmark selector / `del` / `copy` | jump / delete / export pinned lines |
| **viewer**: click a row | copy that exact line (masked text) |
| workbench: level chips, ctx/cap/err-ish, time window | auto re-run after a completed scan |

## Viewer tab (browse the full log)

A second top-level tab for reading logs end-to-end — no rules, no re-scanning:

- **Virtualized streaming**: any file size, constant memory. The view buffers ~900–1600 lines read straight from disk via byte ranges; **wheel / touchpad / touch scroll continuously** — when the buffer edge comes into view the next chunk chains in seamlessly (both directions), with the view pixel-anchored so nothing jumps. The left rail is the whole-file byte map (drag to jump, grab point preserved); window byte offsets are exact UTF-8 lengths, so paging never duplicates or skips lines on non-ASCII content.
- **High-contrast by default** (near-black surface, near-white text) with the shared logcat theme presets in the toolbar.
- **Columns** when lines parse (≈line · timestamp · level · Δt · tag · message), raw monospace otherwise; PII masking applied on display by default (toggle in the toolbar). Δt cells ≥ 5 s are highlighted — a quick read of stalls and silences.
- **Go-to-time**: type an absolute time (`08-25 14:03`) or a relative offset (`+90s`, `-5m30s`, `+2h`) and the view byte-bisects to it — works on multi-GB files without any index.
- **Boot segmentation**: `boots` streams the file for timestamp resets (reboots) and fills a selector — jump to any boot's first line; click again to cancel a scan; progress in the status bar. Note: clocks that step backwards for other reasons (NTP corrections) also register as boundaries.
- **Repeat collapse**: the `≡` toggle merges consecutive identical-shape lines (digits generalized) into one dimmed row with a `× N` badge — the fastest way to see past 100k identical heartbeats. Click the badge to expand that run; expansion state is kept per file.
- **Gap detector**: Δt cells ≥ 5 s render in red; `gap»` streams forward to the next ≥5 s silence and jumps to it.
- **Bookmarks**: `b` pins the centered line (per file, persisted across sessions); the bookmark dropdown jumps to a pin, `del` removes it, `copy` exports all pinned lines.
- **Search-jump**: type a regex, `Enter`/`n` streams forward to the next match, `Shift+Enter`/`N` scans backward, `←`/`→` step through the highlighted matches. Search is independent of rendering — it reads raw bytes from disk (UTF-8-safe byte offsets), so nothing needs to be loaded or scrolled first. Forward scanning starts at the **top of the current view**; each press covers up to **512 MB** (progress in the footer, `Esc` stops) and remembers its position, so multi-GB files are fully searchable across presses. A match re-anchors the view just above it with a focus ring and a `match i/N in view` counter; after EOF the cursor resets, so the next `Enter` wraps to the top; changing the query resets it too. Search matches **every column** (timestamp, level, tag, message). Case-insensitive by default; **Aa** toggles case-sensitive.
- **Layout controls**: `wrap` toggles long-line wrapping; drag the tag/message edge to resize the tag column (double-click = auto-fit); `A−`/`A+` set the viewer font size; click a row to copy the exact (masked) line.
- **Demo** (header button) loads the synthetic sample from either tab — in the viewer it refreshes the file list and opens it automatically; loaded files are never replaced.
- Line numbers are **estimates** (`fileSize / sampled average line length`) — timestamps are the reliable anchor.

## PII scan tab

Find unmasked personal data in loaded logs and turn findings into mask rules.

- **Demo**: press **demo** in the title bar while on this tab — it loads the sample log and auto-starts the scan.
- **Scan**: streams checked files through a 16-detector catalog (VIN, IMEI w/ Luhn, credit card w/ Luhn, SSN, phone, email, device serials, MAC, IPv4/IPv6, GNSS coordinates, subscriberId, Java packages, hex tokens). Any size, constant memory, stoppable. **detectors** opens the per-detector enable/disable list (persisted).
- **Findings table**: per-detector counts + truncated **shape** samples (`YV4…4371`, `someone@example.com` → never the raw value); tick detectors to convert into mask rules with one click (**apply as mask rules**).
- **send to AI wizard**: prepares the requirement prompt with the findings summary + shape samples and pre-checks "send current rules", so the model writes targeted rules for exactly what was found.
- **Download findings .json** for offline review.

## Relationship to scripted pipelines

LogLens is tool-agnostic: its `[Lnnn] <masked line>` extract format and stats JSON are simple enough to feed any scripted pipeline (grep/Python/CI), and rule profiles are plain JSON you can generate or version-control alongside your tooling.

## Development & testing

```
npm test          # 8 suites — 371 assertions (engine, regression, viewer UI/search, team features)
npm run test:e2e  # real-Chromium end-to-end (Playwright, demo→run→viewer→search→theme)
npm run perf      # throughput benchmark (~600k lines synthetic)
```

The E2E drives `loglens.html` in headless Chromium through the full user journey: demo load → run extraction → viewer tab (masked rows) → search-jump with highlight → logcat theme switch — and fails on any console error.

The engine lives in a separate `<script id="core">` block (pure functions, no DOM) so it can be loaded and tested in Node; the UI block guards on `document` and is inert under test. New engine behavior should get assertions in both the spec suite and the regression suite before shipping.

## Troubleshooting / FAQ

**"Run extraction" is disabled** — no files ticked in section 1 (readiness text says so), or a scan/mask job is running.

**Level chips changed but the results didn't** — they re-run automatically after a completed scan; before the first run, press **run**. Continuation (stack-trace) lines inherit their header's level when the filter is narrowed — see [Extraction rules](#2-extraction-rules).

**Include/exclude or mask-rule edits did nothing** — those are scan-time and deliberately not auto-rerun (a re-scan can cover hundreds of MB); the `⚙ settings changed — press run` chip above the results is your cue.

**Direct-to-file checkbox unticks itself** — non-Chromium browser; in-memory mode used instead.

**Exported extract is shorter than "matched" count** — you hit the result cap; banner + file header say so. Re-run with direct-to-file (uncapped) or a narrower filter.

**Chose a font but nothing changed** — font isn't installed; tick *webfonts (online)* (JetBrains Mono, Fira Code, IBM Plex, Source Code Pro, Roboto Mono are fetched; Consolas/Cascadia/Menlo need no download).

**AI wizard: "failed: Failed to fetch"** — usually CORS or a wrong base URL (must be the API root, e.g. `.../v1`). See the note under Connection.

**Time window rejected my input** — check the hint under the inputs. Any of these forms works: `MM-DD HH:MM[:SS]`, ISO 8601 (`2026-08-24[T ]15:37[:01]`, trailing `Z`/offset ignored), syslog (`Aug 24 15:37`, single-digit days ok), Apache/CLF (`[24/Aug/2026:15:37]`). Years and timezone offsets are dropped during normalization (the model is year-less).

**Viewer search said "no matches … from here to end of file"** — each `Enter` scans up to 512 MB to keep the UI responsive; the position is remembered, so press `Enter` again to resume. Reaching the end of file resets the cursor, so the next `Enter` wraps to the top.

**Boot selector shows odd boundaries** — the boot scan treats any backwards timestamp step as a reboot; logs with clock corrections (NTP) or non-monotonic timestamps can produce extra boundaries. Treat them as time markers rather than guaranteed reboots.

**Clipboard copy does nothing** — clipboard API blocked (file:// contexts in some browsers); select the text manually or use downloads.

## Viewer roadmap (researched, not yet built)

From the v1.17 planning pass — all incremental over the byte-window architecture, in build-order preference:

1. **Timeline minimap** — canvas strip above the viewport: event density per time bucket, W/E stacked in level colors, drag-to-brush a time range. Buckets accumulate opportunistically from every decoded window (no full scan required); unpainted buckets render hatched
2. **Live error census** — top-offender panel: tag × message-template ranked by W/E count with a coverage-percentage label; shares the incremental decode pass with the minimap
3. **Split view / compare cursor** — a second virtualized viewport over the same file with independent or time-synced scrolling (boot N vs boot N+1, incident window vs last-known-good)
4. **Inter-module correlation lanes** — right-click a line → swimlane of the top tags active ±30 s around it, dots colored by level, click a dot to jump to that byte offset
5. **Field extraction + facet chips** — user-defined named regexes rendered as extra columns, with value-count chips that populate the search box

## Changelog

- **v1.18.2 (current)** — viewer fix: with **wrap off** (one-line rows), the yellow search-match focus ring only spanned the visible viewport width while the matched line's text extended far to the right in the horizontal scroll — the focused row now expands to its full content width (`width:max-content;min-width:100%`), so the ring encloses the whole line; wrapped mode was and stays correct. CSS regression check in `test_viewer_ui.js` + a real-geometry e2e check (long line uploaded, nowrap, ring width ≥ text width)
- **v1.18.1** — viewer search box gains an inline **✕ clear button** (visible only while the box holds text): one click empties the query, removes every highlight and focus ring, resets the Enter/n/N match cursor, stops a scan that is still running, and restores the status footer — the search state ends up exactly as if no search had been run. Three regression checks in `test_viewer_search.js` + five strict e2e checks (real Chromium)
- **v1.18.0** — performance + worker release. **Scans run off the UI thread**: the workbench run and the PII scan execute in a Web Worker built at runtime from the page's own CORE script (single-file constraint kept) — the UI stays responsive during multi-GB scans, progress and stop work over `postMessage`, direct-to-file export keeps its in-page path, and any environment without `Worker` silently falls back to the previous in-page loops. **Throughput pass on every scanner**: line splitting in all six streaming loops (workbench, PII, mask-only, boots, gap, format sniff) scans by index and copies the remainder once per chunk instead of once per line (~2–3× on the extraction path); mask replacements are precompiled per rule (constant vs `$`-group template) so hits no longer re-resolve the template regex; the sniffed timestamp family is threaded into `parseHeader` so non-logcat formats skip the failing TS regexes; per-line byte accounting gets an ASCII fast path (no `TextEncoder` call per line). **UI debt**: results-filter table re-render is debounced (chips stay live), `localStorage` profile writes are debounced with a beforeunload flush, row tooltips are capped at 1000 chars, and a re-run frees the previous match store (halved peak memory on live re-runs). **Fixes**: viewer search highlighting used a global regex with `test` (lastIndex state made later spans miss their highlight), highlighted the *literal* query while search ran as *regex* (a query like `Auth|GNSS` found rows but never highlighted), and piped raw log text through `innerHTML` (injection risk — highlights are now built with DOM nodes); a file's last unterminated line was never displayed at EOF. E2E verified in real Chromium over `file://` with the scan confirmed running through a real Worker
- **v1.17.0** — viewer analysis release (four features, built in parallel): **go-to-time** — type an absolute time or a relative offset (`+90s`, `-5m30s`, `+2h`) and the view byte-bisects to it; **boot segmentation** — `boots` scans the whole file for timestamp resets and fills a boot selector (click again to cancel; progress in the status bar); **repeat collapse** — the `≡` toggle merges consecutive identical-shape lines into one dimmed row with a `× N` badge (click the badge to expand that run); **gap detector** — Δt cells ≥ 5 s render in warning red and `gap»` jumps to the next such silence (multi-GB-safe streaming scan); **bookmarks** — `b` pins the centered line per file (persisted), the bookmark dropdown jumps, `del` removes, `copy` exports all pinned lines; **PII detector toggles** — enable/disable each detector from the PII scan page (persisted); **live re-run** — context ±, cap, err-ish and the time window now re-run the scan automatically (debounced), and a `⚙ settings changed — press run` chip appears when extract/mask rules differ from the last scan. Also fixes the Δt hour term reading empty slices (hour-boundary gaps displayed as ~24 h)
- **v1.16.0** — workbench restructured around the triage pipeline: a clickable **stepper bar** (`1 load files → 2 filter → 3 run → 4 results → 5 advanced`) with live status counts (files loaded, include/exclude/mask rule counts, match totals) replaces the undifferentiated card stack; section headers are numbered to match; and the two rarely-needed tools (**sanitize copy** and the **AI rule wizard**) moved into a collapsed "advanced" section that opens automatically when its flows run (generate, test, send-to-AI). No functionality moved or removed — all controls live in the same places inside their sections
- **v1.15.1** — workbench level-filter fix: toggling the V/D/I/W/E/F chips now **re-runs the scan automatically** (debounced; previously a completed result never changed until you pressed run again), and lines without a parsed level no longer bypass the level filter — stack-trace/continuation lines now inherit the level of the line they belong to when you narrow the levels (so filtering E keeps an error's stack trace and drops debug chatter), while complete syslog/ISO/CLF lines without a severity field stay visible; header-less orphan lines are dropped only while a narrowed filter is active. Six new regression tests
- **v1.15.0** — viewer analysis pack: **search now matches every column** (timestamp, level, tag, message — highlighting lands in the column that matched, so searching `Tag42` or a module name works); **Δt column** shows the time gap between consecutive timestamped lines (`800ms`, `12.3s`, `1h05m`) — invaluable for spotting stalls, dropped heartbeats and reboot boundaries (toggle in the toolbar, persisted; midnight rollovers handled); **click a row to copy that exact line** (masked text, toast confirms); **A− / A+ font-size buttons** for the viewer (persisted, 9–28px)
- **v1.14.5** — search match walking: `→`/`←` (in the viewer or at the edge of the search box) move the focus ring to the next/previous highlighted match — matches already in view step instantly without a re-scan, and walking past the last one continues the byte scan into the rest of the file; the focused match gets a ring + a `match i/N in view` footer counter, and Enter / n / N share the same walker. Focus is tracked by the line's byte offset (stamped as `data-byte` on each row) so the ring survives buffer shifts from edge chaining
- **v1.14.4** — wrap-off column hardening: with wrap off, text that renders wider than its column (CJK / wide glyphs, font-fallback runs, squeezed widths) can no longer bleed into the neighboring column — timestamp, level and tag columns clip with an ellipsis; monospace font stacks gained `NSimSun` so CJK log text renders at consistent monospaced metrics, and `text-size-adjust:100%` prevents browsers from auto-inflating text sizes
- **v1.14.3** — viewer tag column is **manually resizable**: drag the grip at the tag/message boundary (persisted; double-click returns to auto-fit), and a **wrap** toolbar toggle switches long lines between wrapped rows and one-line rows with horizontal scroll (persisted)
- **v1.14.2** — viewer tag column auto-sizes to the longest tag in the current buffer (clamped 10–24ch) instead of reserving a fixed 16ch, so short tags no longer leave a blank stretch before the message while alignment is kept
- **v1.14.1** — viewer column + search feedback polish: the message column kept a stale ` : ` separator prefix (looked like a misaligned gap after the tag), the tag column was a mostly-empty fixed 20ch and timestamps wrapped inside their 14ch column — columns are now 18ch timestamp / 3ch level / 16ch tag, the separator is stripped, and long searches show live progress (`🔍 scanning "query"… 42% of file`) in the footer with **Esc to stop**; pressing Enter while a scan is already running now explains itself instead of being silently swallowed
- **v1.14.0** — viewer scrolling rebuilt around continuous native scrolling. Previously the wheel dead-stopped at the edge of each ~900-line window (nothing listened to `scroll`), PgUp/PgDn/touch flings replaced the entire window, arrow keys triggered a full disk read + re-render + snap-to-top per keypress (fast input silently dropped by the loading guard), rail drags fired an uncoalesced seek per mousemove that fought the async loads, and window byte offsets used JS char counts — so any non-ASCII line made paging duplicate or skip lines. Now: a scroll listener chains the next/previous chunk at either buffer edge with the view pixel-anchored (wheel/touchpad/touch just scroll, any file size); PgUp/PgDn page the viewport natively and only touch the disk at the buffer edge; arrows move a row via native scroll; the rail uses pointer events with a preserved grab point and coalesces to the latest requested position; seeks landing mid-line are re-aligned so no torn fragments render; all offsets are exact UTF-8 byte lengths; switching to the viewer tab no longer resets the position; `overscroll-behavior:contain` stops EOF wheel events from scrolling the page; masked-text + parsed-header caches keep re-renders cheap
- **v1.13.2** — demo-scale search fix: with a file that fits in one window (e.g. the demo log) the entire file sat inside the initial view, so forward search started past EOF and backward search before BOF — every search reported "no matches". Forward now starts at the **top of the current view**; after a hit the cursor moves past that line so `Enter` walks match-to-match and wraps at EOF; backward walks before the view; changing the query resets the cursor; the 512 MB-per-press cap keeps its continue-cursor. Strict e2e (real `mark` + footer checks replace the lenient fallback that masked this) and a demo-scale + multi-chunk harness scenario
- **v1.13.1** — viewer search repair: `vFind` referenced undefined identifiers (`V.lastByte`, `V.firstByte`, `V_ENC`, `vResetAt`, `vUpdateStatus`), so every search skipped the scan entirely and reported "no matches"; forward/backward search now scans from the current window (`V.winEnd`/`V.winStart`), jumps to and highlights matches, the backward scan walks chunks with correct per-line byte offsets, and the `finally` clears the `#vStatus` indicator without clobbering the footer result; new `test_viewer_search.js` regression suite (forward jump, next-match, multi-chunk backward, no-match, case-insensitive) wired into `npm test`; package.json version resynced
- **v1.13** — pii scan tab: 12-detector catalog (VIN, IMEI w/ Luhn, credit card w/ Luhn, SSN, phone, email, MAC, IPv4/IPv6, serials, subscriberId, packages, hex tokens), streamed multi-file scan with stop button, findings table with shape samples + counts, one-click convert to mask rules, AI wizard handoff (findings + samples as context), findings .json export; GNSS coordinate mask rule + detector; **Aa** case toggle for viewer search; header demo auto-scans the pii tab; GNSS samples in the demo log; version-marker regression test
- **v1.13-pre / v1.12** — pii scanner groundwork: detector catalog defaults, masking coverage table; viewer tab (v1.11): virtualized streaming log browser (byte-fraction rail, ~900-line windows, any file size), high-contrast default theme, column layout for parseable lines, regex search-jump with highlighting and a 512 MB-per-press continue-cursor, keyboard + touch navigation, masking on display, header demo button works in both tabs
- **v1.10** — default PII presets expanded 8 → 15 rules (IBAN, credit card, SSN, international + US phone, IMEI, public IPv4) with false-positive guards for timestamps/epoch-milli/timezone offsets; mobile-responsive layout (≤640 px: wrapped rule editors, 2-column stats, non-sticky run bar)
- **v1.9** — minimal professional UI revamp: dense flat design (single accent, tabular numerals, tighter tables/rules), section headers reduced to micro-labels, verbose descriptions moved into tooltips, emoji stripped from controls — zero functional changes
- **v1.8** — adaptive time-window inputs: format sniffed from the loaded files (placeholder + hint), accepts logcat/ISO/syslog/CLF forms interchangeably, normalized internally
- **v1.7** — timestamp auto-detection (ISO 8601/SQL, RFC3164 syslog, Apache/CLF, bare MM-DD → normalized `MM-DD HH:MM:SS.mmm`); default profile now match-all; all built-in examples/presets genericized (no project-specific content)
- **v1.6** — font selector (11 stacks, optional webfonts), logcat color themes (6 presets), display polish
- **v1.5.1** — per-rule case toggles; independent security audit fixes (attribute-escaping XSS, flag preservation, sink close-on-error, CSV quoting, import validation); DOM-id regression test
- **v1.5** — ±N context lines; per-file stats; histogram click-to-filter; auto-scaling buckets; single-pass masker; gzip exports; folder drop; extraction rule tester + presets; editable errish regex; result cap; readiness summary; filter chips; row-copy; dark mode; AI wizard (samples + rules-context); newline valve; batch output folders with dedupe
- **v1.4** — batch inputs with per-file outputs and output-folder selection; multi-file extract headers
- **v1.3** — mask-only mode (full sanitized copies to disk)
- **v1.2** — multi-GB hardening: single-pass scan, truncation warnings, direct-to-file streaming export, ETA
- **v1.1** — AI rule wizard (bring-your-own endpoint), optional `[Lnnn]` prefix
- **v1.0** — initial: streaming extraction, mask rules, stats, exports, profiles
