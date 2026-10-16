"""Exercise the shipped Nginx routes on a private loopback test instance."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen


def block(source, marker):
    start = source.index(marker)
    end = source.index("\n    }", start) + len("\n    }")
    return source[start:end]


def main():
    source = Path(__file__).with_name("nginx.conf").read_text()
    routes = "\n".join(block(source, marker) for marker in ["    location ~ ^/updates/", "    location /updates/ {"])
    with tempfile.TemporaryDirectory(prefix="zeno-nginx-history-") as temporary:
        root = Path(temporary)
        root.chmod(0o755)
        for version in ["1.0.0", "1.0.1"]:
            metadata = root / "releases" / version / "updates" / "linux" / "x64"
            metadata.mkdir(parents=True)
            (metadata / "latest-linux.yml").write_text(f"version: {version}\n")
        downloads = root / "downloads" / "1.0.0"
        downloads.mkdir(parents=True)
        paths = []
        for platform, os_name, extensions in [("darwin", "mac", ["dmg", "zip"]), ("win32", "win", ["exe"]), ("linux", "linux", ["AppImage", "deb"])]:
            for arch in ["x64", "arm64"]:
                for extension in extensions:
                    filename = f"zeno-{os_name}-{arch}-1.0.0.{extension}"
                    (downloads / filename).write_bytes(bytes(range(128)))
                    paths.append(f"/updates/{platform}/{arch}/{filename}")
        link = root / "release-current"
        link.symlink_to(root / "releases" / "1.0.0", target_is_directory=True)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        user = pwd.getpwuid(os.geteuid()).pw_name
        config = root / "nginx.conf"
        config.write_text(f"user {user};\npid {root}/nginx.pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{ access_log off; server {{ listen 127.0.0.1:{port};\n{routes.replace('/srv/zeno', str(root))}\n}} }}\n")
        process = subprocess.Popen(["/usr/sbin/nginx", "-p", str(root), "-c", str(config), "-g", "daemon off;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        origin = f"http://127.0.0.1:{port}"

        def request(path, headers=None):
            return urlopen(Request(origin + path, headers=headers or {}), timeout=2)

        try:
            for attempt in range(50):
                if process.poll() is not None:
                    raise RuntimeError(process.stderr.read().decode())
                try:
                    with request("/updates/linux/x64/latest-linux.yml") as response:
                        assert response.read() == b"version: 1.0.0\n"
                    break
                except OSError:
                    time.sleep(0.05)
            else:
                raise AssertionError("Private Nginx did not start")
            next_link = root / "release-next"
            next_link.symlink_to(root / "releases" / "1.0.1", target_is_directory=True)
            next_link.replace(link)
            with request("/updates/linux/x64/latest-linux.yml") as response:
                assert response.read() == b"version: 1.0.1\n"
            for path in paths:
                with request(path) as response:
                    assert hashlib.sha256(response.read()).digest() == hashlib.sha256(bytes(range(128))).digest()
                with request(path, {"Range": "bytes=3-9"}) as response:
                    assert response.status == 206
                    assert response.headers["Content-Range"] == "bytes 3-9/128"
                    assert response.read() == bytes(range(3, 10))
            print(json.dumps({"passed": True, "historicalPackages": len(paths), "currentMetadata": "1.0.1", "historicalVersion": "1.0.0", "httpRange": True, "isolation": "private loopback nginx; no public fixtures"}))
        finally:
            process.terminate()
            process.communicate(timeout=10)


if __name__ == "__main__":
    main()
