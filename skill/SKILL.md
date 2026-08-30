---
name: android-log-analysis
description: "Analyze Android logcat/RVDC/bugreport log files: extract relevant lines, mask PII (VIN, email, MAC, IP, serial, GNSS), identify crashes/ANR/connectivity/auth issues, and generate a self-contained HTML report. Use whenever the user mentions log files, logcat, RVDC captures, bug reports, debugging Android issues, PII masking in logs, or wants an HTML analysis report — even if they don't say 'log analysis' explicitly."
---

# Android Log Analysis & Reporting

Analyze Android log files, extract signal from noise, mask PII, and produce an HTML report.

## Core workflow

1. **Verify input files exist** and measure sizes (`dir` or `ls`).
2. **Extract relevant lines** — stream the file line-by-line (never load fully into memory). Match a case-insensitive regex against each line. Prefix each output line with `[L<lineNumber>] ` for traceability.
3. **Mask PII** in every output line before writing (see PII rules below).
4. **Separate an error subset** — lines that are E/W level or contain failure keywords.
5. **Scan for patterns** — crashes, ANR, connectivity, auth, PII leaks.
6. **Generate an HTML report** with timeline, findings by category, and root-cause analysis.

## Critical rules

### Streaming (never load fully)

Files are 100 MB – 4+ GB. Read via line-by-line iteration (`for line in file` in Python, `readline()` in JS). Track byte offsets if position reporting is needed. An 8 MB "newline valve" guards against pathologically long single lines: if the buffer exceeds 8 MB without a newline, force-process it as one line and reset.

### PII masking (mandatory before any output)

Mask these in every output line. Order: specific/context rules first, generic ranges last.

| Detector | Example match | Replacement |
|---|---|---|
| VIN (17 chars) | `YV4AB9CD12EF34567` | first 3 + `**********` + last 4 |
| IBAN | `DE89370400440532013000` | country/check digits kept, rest `*` |
| credit card (Luhn) | `4111 1111 1111 1111` | `[card]` |
| SSN | `123-45-6789` | `123-**-****` |
| phone (intl +) | `+45 12 34 56 78` | `+45 ***` |
| phone (US) | `(555) 123-4567` | `(555) ***-****` |
| IMEI (15 digits) | `356938035643809` | `[IMEI]` |
| email | `user@example.com` | `u***@***` |
| device serial | `SN-abc123def456` | `SN-***` |
| MAC (keep OUI) | `aa:bb:cc:dd:ee:ff` | `aa:bb:cc:**:**:**` |
| private IPv4 | `192.168.1.50` | `192.168.1.x` |
| IPv6 link-local/ULA | `fe80::1234:5678` | `IPv6-masked` |
| GNSS coordinates | `48.858400, 2.294500` | `[coords]` |
| subscriberId | `subscriberId=123456789` | `subscriberId=***` |
| hotspot SSID | `AndroidShare_31415` | `AndroidShare_****` |

False-positive guards (must NOT match):
- Timestamps: `08-24 15:37:01.123`
- Epoch-milliseconds: `1787611054935` (13 digits — IMEI needs 15)
- Timezone offsets: `+0200`
- Version numbers: `2.41.3`

### Timestamp auto-detection

Normalize these formats to a canonical `MM-DD HH:MM:SS.mmm` key so time filters, histograms, and time-span stats work on any log type:

| Source | Example | Normalized |
|---|---|---|
| Android logcat | `08-24 15:37:01.123` | (native) |
| ISO 8601 / SQL | `2026-08-24T15:37:01.123Z` | `08-24 15:37:01.123` |
| RFC3164 syslog | `Aug 24 15:37:01` | `08-24 15:37:01.000` |
| Apache / CLF | `[24/Aug/2026:15:37:01 +00:00]` | `08-24 15:37:01.000` |
| Bare MM-DD | `08-24 15:37:01` | `08-24 15:37:01.000` |

Years and timezone offsets are dropped (the model is year-less and UTC-naive).

### Boundary-inclusive time comparison

Use prefix-slice compare, NOT string comparison:
- `to = "08-24 19:22"` → include lines at `19:22:59.999` (prefix match)
- `from = "08-24 15:37"` → include lines at `15:37:00.000` (prefix match)

### Common pitfalls

1. **V.loading deadlock**: setting a busy flag → async call → guard checks flag → call returns early → flag never reset. Always release the flag before the async call, or use a try/finally.
2. **Attribute-name mismatch**: `dataset.logTheme` sets `data-log-theme`, but CSS selectors use `data-logtheme`. Always use `setAttribute()` / `getAttribute()` with the exact CSS name.
3. **Newline valve**: files with lines > buffer size cause unbounded memory growth. Force-process at 8 MB.
4. **Level filter bypass**: lines without a parseable logcat header have `lvl = null` — they bypass level filters. This is intentional (they may still be relevant).

## Pattern scan checklist

Scan for these patterns in order of diagnostic value:

1. **Crashes**: `FATAL EXCEPTION`, `beginning of crash`, `tombstone`
2. **ANR**: `ANR in `, `Input dispatching timed out`
3. **Process deaths**: `has died`, `am_proc_died`, `Force stopping`
4. **Connectivity**: `ConnectivityService`, `NetworkMonitor`, `DATA_DISCONNECTED`, `WifiService`, `deactivateDataCall`
5. **Auth/security**: `Auth Error`, `Auth Blocked`, `authentication failed`, `token`, `credential`
6. **PII scan**: use the detector catalog above
7. **GNSS/privacy**: `lat/lon pairs (≥3 decimals)`, `position`, `GPS_FIX`
8. **Vendor-specific**: add project-specific patterns as needed

## Report format

Generate a self-contained HTML file with:
- Executive summary (verdict + key numbers)
- Timeline (event sequence with timestamps)
- Error inventory (distinct signatures with counts + examples)
- Root-cause analysis (ranked hypotheses with evidence)
- Next steps (actionable items)
- Findings exported as JSON for tooling

Style: minimal professional design, single accent color, monospace for log content, high-contrast log levels (V/D/I/W/E/F badges).

## References

- [logcat format details](references/logcat_format.md) — header parsing, level meanings, tag conventions

## Scripts

- `scripts/pii_mask.py` — shared PII masking module (importable, CLI testable)
- `scripts/ts_detect.py` — timestamp format auto-detection
