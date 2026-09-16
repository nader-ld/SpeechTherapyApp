#!/usr/bin/env python3
"""Publish a validated local exercise library to owner-only Firestore storage.

Uses the named gcloud account in ignored .private/source.json. Never prints
content or credentials. Does not alter the shared document or its permissions.
"""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--config', type=Path, default=ROOT / '.private/source.json')
parser.add_argument('--library', type=Path, default=ROOT / '.private/library.json')
args = parser.parse_args()
config = json.loads(args.config.read_text())
library = json.loads(args.library.read_text())
subprocess.run(['node', str(ROOT / 'scripts/validate.mjs'), str(args.library.resolve())], check=True)
source_url = config.get('documentUrl', '')
parsed = urllib.parse.urlparse(source_url)
if source_url and (parsed.scheme != 'https' or parsed.netloc != 'docs.google.com' or not parsed.path.startswith('/document/d/')):
    raise SystemExit('documentUrl must be a private Google Docs link.')
raw = json.dumps(library, ensure_ascii=False)
if len(raw.encode()) > 900_000:
    raise SystemExit('Library exceeds the safe single-document size; split it before publishing.')
project = config['project']
account = config['account']
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token', '--account=' + account], text=True).strip()
base = 'https://firestore.googleapis.com/v1/projects/' + urllib.parse.quote(project, safe='') + '/databases/(default)/documents/private/library'
fields = {'json': {'stringValue': raw}, 'sourceDocumentUrl': {'stringValue': source_url},
          'publishedAt': {'timestampValue': datetime.datetime.now(datetime.timezone.utc).isoformat()}}
query = urllib.parse.urlencode([('updateMask.fieldPaths', key) for key in fields])
headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
request = urllib.request.Request(base + '?' + query, data=json.dumps({'fields': fields}).encode(), headers=headers, method='PATCH')
with urllib.request.urlopen(request) as response:
    saved = json.load(response)
if saved.get('fields', {}).get('json', {}).get('stringValue') != raw:
    raise SystemExit('Readback mismatch: publication could not be verified.')
print('Published and verified the private exercise library and source link. No hosting files were created.')
