#!/usr/bin/env python3
"""Upload a snapshot of the repo to Google Drive: Curbside/Snapshots/.

Uploads two files named after today's date and the current commit:
  curbside-<date>-<sha>.zip      tracked files at HEAD (git archive)
  curbside-<date>-<sha>.bundle   full git history (restore: git clone <file>)
and refreshes Curbside/PLAN.md from docs/PLAN.md so the Drive copy stays in sync.

Uses the stored OAuth credential of hive1's gworkspace MCP (Drive scope);
stdlib only. Usage:  python3 -I tools/drive-snapshot.py [--folder-id ID]
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

CRED_FILE = os.environ.get(
    "GWORKSPACE_CRED", "/home/dmw/.config/gworkspace-mcp/credentials/pydron@gmail.com.json"
)
# Drive folder "GameDev/Curbside".
CURBSIDE_FOLDER = "1eio0sxJNMjH_N9VT9GMTVTRqEIXoLNu7"
API = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def access_token() -> str:
    with open(CRED_FILE) as f:
        creds = json.load(f)
    data = urllib.parse.urlencode(
        {
            "client_id": creds["client_id"],
            "client_secret": creds["client_secret"],
            "refresh_token": creds["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode()
    with urllib.request.urlopen(urllib.request.Request(creds["token_uri"], data=data)) as r:
        return json.load(r)["access_token"]


def api(token, url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def ensure_folder(token, parent, name) -> str:
    q = (
        f"name = '{name}' and '{parent}' in parents and "
        "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    found = api(token, f"{API}?{urllib.parse.urlencode({'q': q, 'fields': 'files(id)'})}")["files"]
    if found:
        return found[0]["id"]
    meta = {"name": name, "parents": [parent], "mimeType": "application/vnd.google-apps.folder"}
    return api(token, API, json.dumps(meta).encode(), {"Content-Type": "application/json"})["id"]


def upload(token, folder, path, name, mime):
    boundary = "curbside-snapshot-boundary"
    meta = json.dumps({"name": name, "parents": [folder]})
    with open(path, "rb") as f:
        content = f.read()
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n"
        f"--{boundary}\r\nContent-Type: {mime}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return api(token, UPLOAD, body, {"Content-Type": f"multipart/related; boundary={boundary}"})


def sync_plan(token, folder):
    """Overwrite Curbside/PLAN.md's content with docs/PLAN.md (same file id, keeps history)."""
    q = f"name = 'PLAN.md' and '{folder}' in parents and trashed = false"
    found = api(token, f"{API}?{urllib.parse.urlencode({'q': q, 'fields': 'files(id)'})}")["files"]
    with open(os.path.join(REPO, "docs", "PLAN.md"), "rb") as f:
        content = f.read()
    if found:
        url = f"https://www.googleapis.com/upload/drive/v3/files/{found[0]['id']}?uploadType=media"
        api(token, url, content, {"Content-Type": "text/markdown"}, method="PATCH")
        print("updated PLAN.md in Drive")


def git(*args, **kw):
    return subprocess.run(["git", "-C", REPO, *args], check=True, capture_output=True, text=True, **kw).stdout.strip()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--folder-id", default=CURBSIDE_FOLDER)
    args = p.parse_args()

    if git("status", "--porcelain"):
        print("warning: uncommitted changes are NOT in the snapshot (it captures HEAD)", file=sys.stderr)
    sha = git("rev-parse", "--short", "HEAD")
    stem = f"curbside-{datetime.date.today().isoformat()}-{sha}"

    token = access_token()
    folder = ensure_folder(token, args.folder_id, "Snapshots")
    with tempfile.TemporaryDirectory() as tmp:
        zip_path = os.path.join(tmp, f"{stem}.zip")
        bundle_path = os.path.join(tmp, f"{stem}.bundle")
        git("archive", "--format=zip", f"--prefix=curbside/", "-o", zip_path, "HEAD")
        git("bundle", "create", bundle_path, "--all")
        for path, mime in ((zip_path, "application/zip"), (bundle_path, "application/octet-stream")):
            r = upload(token, folder, path, os.path.basename(path), mime)
            print(f"uploaded {r['name']} ({int(r['size']) // 1024} KB) id={r['id']}")
    sync_plan(token, args.folder_id)
    print(f"https://drive.google.com/drive/folders/{folder}")


if __name__ == "__main__":
    main()
