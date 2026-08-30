"""Shared PII masking for Android log analysis.

Apply mask_line() to every output line before writing to any artifact.

Usage:
    from pii_mask import mask_line
    masked = mask_line(raw_line)

CLI test:  python pii_mask.py
"""
import re

VIN_CH = 'A-HJ-NPR-Z0-9'  # VIN alphabet range (no I/O/Q), no brackets

RULES = [
    # VIN (17 chars, any maker)
    (re.compile(r'(?<![A-Za-z0-9])([' + VIN_CH + r']{3})([' + VIN_CH + r']{10})([' + VIN_CH + r']{4})(?![A-Za-z0-9])'),
     lambda m: m.group(1) + '*' * 10 + m.group(3)),
    # IBAN
    (re.compile(r'\b([A-Z]{2}\d{2})[A-Z0-9]{10,26}\b'),
     lambda m: m.group(1) + '**********'),
    # credit card (13-19 digits, grouped or not)
    (re.compile(r'\b\d{4}(?:[ -]?\d{4}){3}\b'),
     lambda m: '[card]'),
    # SSN
    (re.compile(r'\b(\d{3})-(\d{2})-(\d{4})\b'),
     lambda m: m.group(1) + '-**-****'),
    # phone (international with +)
    (re.compile(r'(?<!\d)(\+\d{1,3})[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,3}(?!\d)'),
     lambda m: m.group(1) + ' ***'),
    # phone (US paren)
    (re.compile(r'(?<!\d)(\(\d{3}\))[ -]?\d{3}[ -]?\d{4}(?!\d)'),
     lambda m: m.group(1) + ' ***-****'),
    # IMEI (15 digits)
    (re.compile(r'(?<!\d)\d{15}(?!\d)'),
     lambda m: '[IMEI]'),
    # email
    (re.compile(r'\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)\.([A-Za-z]{2,})\b'),
     lambda m: m.group(1) + '***@***.' + m.group(3)),
    # device serial (SN-xxx)
    (re.compile(r'\b(SN-)[0-9A-Fa-f]{6,}\b'),
     lambda m: m.group(1) + '***'),
    # MAC (keep OUI)
    (re.compile(r'\b([0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})(?::[0-9A-Fa-f]{2}){3}\b'),
     lambda m: m.group(1) + ':**:**:**'),
    # private IPv4 (mask last octet)
    (re.compile(r'\b((?:10\.\d+\.\d+|192\.168\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+))\.(\d{1,3})\b'),
     lambda m: m.group(1) + '.x'),
    # public IPv4 (mask last two octets)
    (re.compile(r'\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b'),
     lambda m: m.group(1) + '.x.x'),
    # IPv6 link-local / ULA
    (re.compile(r'\b(?:fe80::[0-9A-Fa-f:]{2,}|fd[0-9A-Fa-f]{2}::[0-9A-Fa-f:]{2,})'),
     lambda m: 'IPv6-masked'),
    # GNSS coordinates (decimal degrees pair, ≥3 decimals)
    (re.compile(r'(?<![\d.])-?(?:[0-8]?\d|90)\.\d{3,7}\s*°?\s*[NS]?\s*,?\s*-?(?:1?[0-7]?\d|180)\.\d{3,7}(?![\d.])'),
     lambda m: '[coords]'),
    # subscriberId
    (re.compile(r'(subscriberId[=:])\s*\d+'),
     lambda m: m.group(1) + '***'),
    # hotspot SSID
    (re.compile(r'(AndroidShare_)\d+'),
     lambda m: m.group(1) + '****'),
]


def mask_line(s):
    for rx, fn in RULES:
        s = rx.sub(fn, s)
    return s


if __name__ == '__main__':
    samples = [
        'vin=YV4AB9CD12EF34567 ouvid=YV4AB9CD12EF34567',
        '"vehicleId":"YV4AB9CD12EF34567"',
        'contact: someone@example.com done',
        'user henry@example.com NET job',
        '"dID":"SN-abc123def456"',
        'hwAddr: aa:bb:cc:dd:ee:ff',
        'ipv4 192.168.1.100 up',
        'ip 203.0.113.42 forwarding',
        'addr fe80::1234:5678:9abc:def0',
        'GNSS fix 48.858400, 2.294500 sats=9',
        'position 48.858412°N, 2.294511°E',
        'subscriberId=123456789012',
        'ssid AndroidShare_31415',
        'card 4111 1111 1111 1111 charged',
        'iban DE89370400440532013000 active',
        'ssn 123-45-6789 on file',
        'call +45 12 34 56 78 now',
        'imei 356938035643809 reported',
        'plain text with no PII',
    ]
    for s in samples:
        m = mask_line(s)
        status = 'CHANGED' if m != s else 'unchanged'
        print(f'[{status:9s}] {s}')
        if m != s:
            print(f'           → {m}')
