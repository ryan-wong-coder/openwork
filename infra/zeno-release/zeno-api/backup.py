#!/usr/bin/env python3
"""Consistent private SQLite/media snapshot. No network or model credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
from datetime import datetime, timezone
from uuid import uuid4


def backup(database: Path, media_root: Path, destination: Path) -> Path:
    database, media_root, destination = database.resolve(), media_root.resolve(), destination.resolve()
    if str(destination).startswith('/srv/zeno/') or destination == Path('/srv/zeno'):
        raise ValueError('Backups must be outside public website/download directories')
    if destination == media_root or media_root in destination.parents:
        raise ValueError('Backup destination must be separate from live media')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(destination, 0o700)
    pending = destination / ('.pending-' + uuid4().hex)
    pending.mkdir(mode=0o700)
    source = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
    try:
        # Pin one SQLite read snapshot while backing up the matching media rows.
        source.execute('BEGIN')
        rows = source.execute('SELECT user_id,storage_key,bytes,sha256 FROM media ORDER BY user_id,id').fetchall()
        snapshot = sqlite3.connect(pending / 'accounts.sqlite')
        try:
            source.backup(snapshot)
            if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Backup integrity check failed')
        finally:
            snapshot.close()
        os.chmod(pending / 'accounts.sqlite', 0o600)
        total = 0
        for user_id, storage_key, size, expected_hash in rows:
            if not re.fullmatch(r'[A-Za-z0-9._:-]{1,200}', user_id) or user_id in ('.', '..') or not re.fullmatch(r'[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|webm)', storage_key):
                raise ValueError('Invalid private media identity')
            source_file = media_root / user_id / storage_key
            target_file = pending / 'media' / user_id / storage_key
            target_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            digest = hashlib.sha256()
            descriptor = os.open(source_file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            with os.fdopen(descriptor, 'rb') as original, target_file.open('xb') as copied:
                info = os.fstat(original.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size != size:
                    raise ValueError('Media changed during backup; retry a fresh snapshot')
                for chunk in iter(lambda: original.read(1024 * 1024), b''):
                    digest.update(chunk)
                    copied.write(chunk)
                copied.flush()
                os.fsync(copied.fileno())
            os.chmod(target_file, 0o600)
            if digest.hexdigest() != expected_hash:
                raise ValueError('Media checksum mismatch; no backup published')
            total += size
        source.rollback()
        manifest = {'format': 'zeno-private-backup', 'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'mediaCount': len(rows), 'mediaBytes': total, 'databaseSha256': hashlib.sha256((pending / 'accounts.sqlite').read_bytes()).hexdigest()}
        (pending / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        os.chmod(pending / 'manifest.json', 0o600)
        target = destination / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:8])
        pending.rename(target)
        return target
    except BaseException:
        shutil.rmtree(pending)
        raise
    finally:
        source.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--media-root', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    result = backup(args.database, args.media_root, args.destination)
    # Count/status only; never print account IDs, media paths or auth material.
    manifest = json.loads((result / 'manifest.json').read_text())
    print(json.dumps({'ok': True, 'snapshot': result.name, 'mediaCount': manifest['mediaCount']}))
