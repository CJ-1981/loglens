"""Timestamp format auto-detection for Android log analysis.

Detects common timestamp formats and normalizes to MM-DD HH:MM:SS.mmm.

Usage:
    from ts_detect import detect_ts
    ts = detect_ts(line)  # returns "MM-DD HH:MM:SS.mmm" or None

CLI test:  python ts_detect.py
"""
import re

MM = r'0[1-9]|1[0-2]'
DD = r'0[1-9]|[12]\d|3[01]'
DD1 = r'0?[1-9]|[12]\d|3[01]'
HH = r'[01]\d|2[0-3]'
MI = r'[0-5]\d'
SS = r'[0-5]\d'
MON = {'jan':'01','feb':'02','mar':'03','apr':'04','may':'05','jun':'06',
       'jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12'}


def _p2(n):
    return '0' + n if len(n) == 1 else n


# (compiled regex, normalizer fn) — tried in order, first match wins
PATTERNS = [
    # ISO 8601 / SQL: 2026-08-24[T ]15:37:01(.123)?(Z|±HH:MM)?
    (re.compile(r'\b(\d{4})-(' + MM + r')-(' + DD + r')[T ](' + HH + r'):(' + MI + r'):(' + SS + r')(?:\.(\d{1,3}))?', re.I),
     lambda m: m.group(2) + '-' + m.group(3) + ' ' + m.group(4) + ':' + m.group(5) + ':' + m.group(6) + '.' + (m.group(7) or '0').padEnd(3,'0').slice(0,3) if False else
               m.group(2) + '-' + m.group(3) + ' ' + m.group(4) + ':' + m.group(5) + ':' + m.group(6) + '.' + ((m.group(7) or '0') + '000')[:3]),
    # RFC3164 syslog: Aug 24 15:37:01 (day may be space-padded single digit)
    (re.compile(r'\b([A-Za-z]{3})\s+(' + DD1 + r')\s+(' + HH + r'):(' + MI + r'):(' + SS + r')(?:\.(\d{1,3}))?\b'),
     lambda m: (MON.get(m.group(1).lower(), '') and MON[m.group(1).lower()] + '-' + _p2(m.group(2)) + ' ' + m.group(3) + ':' + m.group(4) + ':' + m.group(5) + '.000') or None),
    # Apache/CLF: [24/Aug/2026:15:37:01 +00:00]
    (re.compile(r'\[(' + DD1 + r')/([A-Za-z]{3})/\d{4}:(' + HH + r'):(' + MI + r'):(' + SS + r')'),
     lambda m: MON.get(m.group(2).lower(), '') and m.group(1) and MON[m.group(2).lower()] + '-' + _p2(m.group(1)) + ' ' + m.group(3) + ':' + m.group(4) + ':' + m.group(5) + '.000' or None),
    # bare MM-DD HH:MM:SS (logcat-style without pid/tid)
    (re.compile(r'\b(' + MM + r')-(' + DD + r')\s+(' + HH + r'):(' + MI + r'):(' + SS + r')(?:\.(\d{1,3}))?\b'),
     lambda m: m.group(1) + '-' + m.group(2) + ' ' + m.group(3) + ':' + m.group(4) + ':' + m.group(5) + '.' + ((m.group(6) or '0') + '000')[:3]),
    # Android logcat with milliseconds: MM-DD HH:MM:SS.mmm
    (re.compile(r'\b(' + MM + r')-(' + DD + r')\s+(' + HH + r'):(' + MI + r'):(' + SS + r')\.(\d{3})\b'),
     lambda m: m.group(1) + '-' + m.group(2) + ' ' + m.group(3) + ':' + m.group(4) + ':' + m.group(5) + '.' + m.group(6)),
]


def detect_ts(line):
    """Return normalized 'MM-DD HH:MM:SS.mmm' or None."""
    for rx, fn in PATTERNS:
        m = rx.search(line)
        if m:
            try:
                result = fn(m)
                if result:
                    return result
            except (KeyError, IndexError, AttributeError):
                continue
    return None


if __name__ == '__main__':
    samples = [
        '08-24 15:37:01.123  4111  7681 I Tag: logcat line',
        '2026-08-24T15:37:01Z info: ISO with Z',
        '2026-08-24 15:37:01 worker: done',
        'Aug 24 15:37:01 host app[123]: oops',
        'Sep  9 08:05:59 myhost crond: tick',
        '[24/Aug/2026:15:37:01 +00:00] GET /a 200',
        '08-24 15:37:01 app: started',
        'no timestamp at all',
        'random text 99-99 99:99:99 invalid',
    ]
    for s in samples:
        r = detect_ts(s)
        print(f'{"✓" if r else "✗"} {s}')
        if r:
            print(f'  → {r}')
