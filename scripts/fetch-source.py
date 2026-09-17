#!/usr/bin/env python3
"""Fetch the therapist's Google Doc into the ignored .private/source/ folder.

Reads the document id and account from .private/source.json, gets an access
token from the local gcloud login (same as scripts/publish-library.py), and
exports the doc as plain text and PDF. Prints only file names and whether the
text changed since the last fetch; never prints document content.

One-time setup, because the default gcloud login has no Drive scope:
    gcloud auth login nader.ld89@gmail.com --enable-gdrive-access

Usage: npm run fetch:source
"""
import datetime
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / '.private'
OUT = PRIVATE / 'source'
CONFIG = PRIVATE / 'source.json'
LOGIN_HINT = 'Run once:  gcloud auth login {account} --enable-gdrive-access'

config = json.loads(CONFIG.read_text())
account = config['account']
url = config.get('documentUrl', '')
doc_id = config.get('documentId') or urllib.parse.urlparse(url).path.split('/d/')[-1].split('/')[0]
if not doc_id:
    sys.exit('No document id: set documentUrl or documentId in .private/source.json')

try:
    token = subprocess.check_output(
        ['gcloud', 'auth', 'print-access-token', '--account=' + account], text=True, stderr=subprocess.STDOUT,
    ).strip()
except subprocess.CalledProcessError as e:
    sys.exit(f'gcloud has no login for {account}.\n{LOGIN_HINT.format(account=account)}')


def export(mime):
    q = urllib.parse.urlencode({'mimeType': mime})
    req = urllib.request.Request(
        f'https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(doc_id)}/export?{q}',
        headers={'Authorization': 'Bearer ' + token},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        if e.code in (401, 403) and ('insufficient' in body.lower() or 'scope' in body.lower()):
            sys.exit(f'The gcloud login for {account} cannot read Drive yet.\n{LOGIN_HINT.format(account=account)}')
        if e.code == 404:
            sys.exit('Document not found. Check documentUrl in .private/source.json and that the account can open it.')
        sys.exit(f'Drive export failed: HTTP {e.code}')


OUT.mkdir(parents=True, exist_ok=True)
stamp = datetime.date.today().isoformat()
text = export('text/plain')
pdf = export('application/pdf')

latest_txt = OUT / 'ND_Activities-latest.txt'
previous_hash = hashlib.sha256(latest_txt.read_bytes()).hexdigest() if latest_txt.exists() else None
new_hash = hashlib.sha256(text).hexdigest()

if previous_hash == new_hash:
    print(f'No change since the last fetch ({latest_txt.relative_to(ROOT)}).')
    sys.exit(0)

if latest_txt.exists():
    prev_copy = OUT / f'ND_Activities-previous.txt'
    prev_copy.write_bytes(latest_txt.read_bytes())
    print(f'Previous text kept at {prev_copy.relative_to(ROOT)}')

(OUT / f'ND_Activities-{stamp}.txt').write_bytes(text)
(OUT / f'ND_Activities-{stamp}.pdf').write_bytes(pdf)
latest_txt.write_bytes(text)
(OUT / 'ND_Activities-latest.pdf').write_bytes(pdf)
print(f'Fetched {len(text)} chars of text and a {len(pdf)} byte PDF into {OUT.relative_to(ROOT)}/')
print('Changed since the last fetch.' if previous_hash else 'First fetch.')
