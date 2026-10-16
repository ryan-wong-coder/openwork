"""Receive short-lived GitHub asset URLs on stdin; never log or persist URLs."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def mirror(asset, output):
    name = asset["name"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ValueError("Unsafe asset name")
    url = urlsplit(asset["downloadUrl"])
    if url.scheme != "https" or url.username or url.password or not url.hostname:
        raise ValueError("Asset URL must use HTTPS")
    size = asset["size"]
    digest = asset.get("digest")
    if not isinstance(size, int) or size <= 0 or not isinstance(digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("GitHub asset size and digest are required")
    destination = output / name

    def verified(path):
        if not path.is_file() or path.stat().st_size != size:
            return False
        with path.open("rb") as source:
            return "sha256:" + hashlib.file_digest(source, "sha256").hexdigest() == digest

    if verified(destination):
        print(f"Verified existing {name}", flush=True)
        return
    temporary = output / (name + ".part")
    offset = temporary.stat().st_size if temporary.is_file() and temporary.stat().st_size < size else 0
    headers = {"User-Agent": "Zeno-Release-Mirror", **({"Range": f"bytes={offset}-"} if offset else {})}
    with urlopen(Request(asset["downloadUrl"], headers=headers), timeout=90) as response:
        if response.status == 200:
            offset = 0
        elif response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
            raise ValueError("Unexpected download response")
        written = offset
        with temporary.open("ab" if offset else "wb") as target:
            while chunk := response.read(1024 * 1024):
                written += len(chunk)
                if written > size:
                    raise ValueError("Asset exceeded declared size")
                target.write(chunk)
    if not verified(temporary):
        temporary.unlink(missing_ok=True)
        raise ValueError("Asset integrity mismatch")
    temporary.chmod(0o644)
    temporary.replace(destination)
    print(f"Mirrored {name} ({size} bytes)", flush=True)


def main():
    if len(sys.argv) != 2:
        raise ValueError("Expected a private staging output directory")
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    assets = json.load(sys.stdin)
    if not isinstance(assets, list) or not assets or len({asset["name"] for asset in assets}) != len(assets):
        raise ValueError("Expected unique release assets")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = [pool.submit(mirror, asset, output) for asset in assets]
        failures = 0
        for asset, result in zip(assets, results):
            try:
                result.result()
            except Exception as error:
                # Network exceptions may contain signed URLs. Report type only.
                print(f"Failed {asset['name']}: {type(error).__name__}", file=sys.stderr, flush=True)
                failures += 1
        if failures:
            raise RuntimeError(f"{failures} assets failed; obtain fresh URLs and retry")


if __name__ == "__main__":
    main()
