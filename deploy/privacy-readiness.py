#!/usr/bin/env python3
"""Check release evidence completeness/integrity, not legal compliance or geography.

No network, no database writes, no document/PII contents in diagnostics.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sys

REQUIRED_EVIDENCE = (
    'policy', 'lawfulBases', 'processors', 'rknNotification', 'threatModel',
    'protectionMeasures', 'subjectRequests', 'erasureRestoreDrill', 'incidentDrill',
    'retention', 'consents', 'minors', 'chatClassification', 'paymentsAndAdvertising',
)
REQUIRED_STORES = {'game', 'corporations', 'telemetry', 'backups'}


def secure_file(value):
    if not isinstance(value, str) or not value.startswith('/'):
        return None
    path = Path(value)
    try:
        if path.is_symlink() or not path.is_file():
            return None
        st = path.stat()
        if st.st_uid not in (0, os.getuid()) or st.st_mode & 0o022:
            return None
        return path
    except OSError:
        return None


def check(manifest):
    errors = []
    today = datetime.datetime.now(datetime.timezone.utc).date()
    if not isinstance(manifest, dict) or manifest.get('version') != 1:
        return ['schema']
    operator = manifest.get('operator', {})
    if not isinstance(operator, dict):
        return ['operator']
    for key in ('name', 'address', 'contactEmail'):
        value = operator.get(key)
        if not isinstance(value, str) or len(value.strip()) < 3 or re.search(r'TODO|TBD|example|заполн', value, re.I):
            errors.append('operator.' + key)
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', str(operator.get('contactEmail', ''))):
        errors.append('operator.contactEmail')
    if not isinstance(manifest.get('approvedBy'), str) or not manifest['approvedBy'].strip():
        errors.append('approvedBy')
    try:
        approved = datetime.date.fromisoformat(manifest.get('reviewedAt', ''))
        if not 0 <= (today - approved).days <= 90:
            errors.append('reviewedAt')
    except (TypeError, ValueError):
        errors.append('reviewedAt')

    def evidence(value, label):
        if not isinstance(value, dict):
            errors.append(label)
            return
        path = secure_file(value.get('path'))
        digest = value.get('sha256')
        if path is None or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            errors.append(label)
            return
        try:
            if path.stat().st_size == 0 or path.stat().st_size > 10 * 1024 * 1024:
                errors.append(label)
            elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                errors.append(label)
        except OSError:
            errors.append(label)

    documents = manifest.get('evidence', {})
    for key in REQUIRED_EVIDENCE:
        evidence(documents.get(key) if isinstance(documents, dict) else None, 'evidence.' + key)
    stores = manifest.get('stores', [])
    seen = set()
    if isinstance(stores, list):
        for store in stores:
            if not isinstance(store, dict) or store.get('role') not in REQUIRED_STORES:
                errors.append('stores.schema')
                continue
            role = store['role']
            if role in seen or store.get('country') != 'RU' or not store.get('provider'):
                errors.append('stores.' + role)
            seen.add(role)
            evidence(store.get('evidence'), 'location.' + role)
    if seen != REQUIRED_STORES:
        errors.append('stores.missing')
    return sorted(set(errors))


def main():
    path = secure_file(sys.argv[1]) if len(sys.argv) == 2 else None
    try:
        if path is None or path.stat().st_size > 128 * 1024:
            raise ValueError()
        failures = check(json.loads(path.read_text()))
    except (OSError, ValueError, TypeError):
        failures = ['manifest']
    if failures:
        print('E_PRIVACY_RELEASE: ' + ', '.join(failures), file=sys.stderr)
        return 1
    print('Privacy evidence manifest checked; operator review and factual accuracy remain required.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
