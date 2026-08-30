# Android Log Format Reference

## Primary format: Android logcat

```
MM-DD HH:MM:SS.mmm  PID TID L TAG: message
```

- `MM-DD` — date (no year)
- `PID` — process ID (decimal)
- `TID` — thread ID (decimal)
- `L` — priority level: V < D < I < W < E < F
- `TAG` — component tag, **may contain `:`** (e.g. `SXM:S:K2IP`, `MyApp:Sub`)
  - Separator between TAG and message is colon + space (not just colon)

### Level meanings

| Level | Name | Typical use |
|---|---|---|
| V | Verbose | Extreme detail, usually disabled |
| D | Debug | Development diagnostics |
| I | Info | Normal operation milestones |
| W | Warning | Recoverable issues, deprecation notices |
| E | Error | Operation failures, exceptions |
| F | Fatal | Process-killing crashes (rare in logcat; usually E) |

### Level filter bypass

Lines without a parseable logcat header have `lvl = null` — they **bypass level filters**. This is intentional: stack-trace continuation lines (`	at com.foo.Bar.method`) and raw dump lines don't carry headers but may still be relevant.

### Tag parsing: colon-in-tag

The TAG field may contain colons (e.g. `SXM:S:SatIpControl`). The separator between TAG and MESSAGE is colon + space (`": "`), not just colon. Use non-greedy matching or split on the LAST `": "` before the message begins.

## Other recognized formats

### RFC3164 syslog
```
Mon DD HH:MM:SS host process[pid]: message
```
Day may be space-padded single digit (`Sep  9`). Normalized to `MM-DD HH:MM:SS.000`.

### ISO 8601 / SQL
```
2026-08-24T15:37:01.123Z
2026-08-24 15:37:01
```
Year and timezone are dropped (year-less model). Normalized to `MM-DD HH:MM:SS.mmm`.

### Apache / CLF
```
[24/Aug/2026:15:37:01 +00:00] "GET /path HTTP/1.1" 200
```

### Bare MM-DD
```
08-24 15:37:01 message
```

### Kernel messages (no timestamp)
```
<3>[12345.678901] module: error message
```
No timestamp to parse; treated as unheaded lines.

## PID/TID parsing notes

- PID and TID are decimal, separated by whitespace
- Kernel threads have PID 0 or low values
- In logcat, PID + TID + level + tag are separated by 2+ spaces

## Tag conventions (vehicle/embedded)

| Prefix | Source |
|---|---|
| `SXM:S:*` | SiriusXM middleware (SSAM/SXE) |
| `MyApp:*` | Generic app |
| `ConnectivityService` | Android framework network |
| `vendor.*` | Vendor HAL / native service |

## Common false-positive patterns for PII masking

| Pattern | Why it looks like PII | Why it isn't |
|---|---|---|
| `08-24 15:37:01.123` | Digits like ID | Timestamp — colon-separated |
| `1787611054935` | 13 digits like IMEI | Epoch milliseconds |
| `2.41.3` | Dotted quad like IP | Version number (only 3 parts) |
| `+0200` | Starts with + like phone | Timezone offset |
| `1.2345` | Decimal like GNSS | Ratio/measurement (no pair) |
| `ff02::1` | IPv6-colon format | Multicast (not unicast) |
