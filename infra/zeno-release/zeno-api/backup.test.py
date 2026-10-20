import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('zeno_backup', Path(__file__).with_name('backup.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupTest(unittest.TestCase):
    def test_wal_snapshot_and_referenced_media_restore(self):
        with tempfile.TemporaryDirectory(prefix='zeno-backup-test-') as root:
            root = Path(root)
            database = sqlite3.connect(root / 'accounts.sqlite')
            database.execute('PRAGMA journal_mode=WAL')
            database.execute('CREATE TABLE media(user_id TEXT,storage_key TEXT,id TEXT,bytes INTEGER,sha256 TEXT)')
            media = root / 'media' / 'synthetic-user'
            media.mkdir(parents=True)
            key = '11111111-1111-1111-1111-111111111111.png'
            payload = b'synthetic-non-private-media'
            (media / key).write_bytes(payload)
            database.execute('INSERT INTO media VALUES(?,?,?,?,?)', ('synthetic-user', key, 'media-one', len(payload), hashlib.sha256(payload).hexdigest()))
            database.commit()
            snapshot = module.backup(root / 'accounts.sqlite', root / 'media', root / 'backups')
            restored = sqlite3.connect(snapshot / 'accounts.sqlite')
            self.assertEqual(restored.execute('SELECT COUNT(*) FROM media').fetchone()[0], 1)
            self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual((snapshot / 'media' / 'synthetic-user' / key).read_bytes(), payload)
            self.assertEqual((snapshot.stat().st_mode & 0o777), 0o700)
            self.assertEqual(((snapshot / 'accounts.sqlite').stat().st_mode & 0o777), 0o600)
            restored.close()
            (media / key).write_bytes(b'corrupted')
            with self.assertRaises(ValueError):
                module.backup(root / 'accounts.sqlite', root / 'media', root / 'backups')
            self.assertEqual(len(list((root / 'backups').iterdir())), 1)
            database.close()

    def test_public_destination_is_rejected_before_writing(self):
        with self.assertRaises(ValueError):
            module.backup(Path('/nonexistent-db'), Path('/private/media'), Path('/srv/zeno/backups'))


if __name__ == '__main__':
    unittest.main()
