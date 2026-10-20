#!/usr/bin/env python3
"""Retrieve allowlisted openGym v1.4.1 text sources only. Never downloads exercise media."""
import concurrent.futures, hashlib, json, re, subprocess, tempfile
from pathlib import Path, PurePosixPath
SHA = "464355ef43d4c8f8a4e0bb6db9c2af7f240593b5"
ROOT = Path(__file__).resolve().parents[1]
ROOTS = "progression onerm recovery history muscles exercises workout-model routines session-start session-edit rotation session-merge supersetFlow structuralBalance measurements import-csv import-hevy plan-share fit-export zip body-paths starter effort plates bar dumbbells finish-workout session-repeat session-noprog active-exercise-swap active-workout-order health-connect".split()
seen = {}
def fetch(path):
    if "media/" in path or not path.startswith("frontend/src/") or not path.endswith((".js", ".json")):
        raise ValueError("non-code path refused: " + path)
    cache = Path(tempfile.gettempdir()) / ("zeno-fitness-upstream-" + SHA) / path
    if cache.exists(): return cache.read_bytes()
    raw = subprocess.check_output(["gh", "api", f"repos/DuarteSantos8/openGym/contents/{path}?ref={SHA}", "-H", "Accept: application/vnd.github.raw+json"])
    cache.parent.mkdir(parents=True, exist_ok=True); cache.write_bytes(raw)
    return raw
pending = {f"frontend/src/lib/{name}.js" for name in ROOTS}
while pending:
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        batch = list(pool.map(lambda path: (path, fetch(path)), sorted(pending)))
    pending = set()
    for path, raw in batch:
        seen[path] = raw
        code = raw.decode()
        for rel in re.findall(r"(?m)^import[^\n]*?from\s*[\"']([^\"']+)[\"']", code):
            if not rel.startswith("."):
                raise ValueError("external dependency requires review: " + path + " " + rel)
            target = str(PurePosixPath(path).parent / rel)
            parts = []
            for part in target.split("/"):
                if part == "..": parts.pop()
                elif part != ".": parts.append(part)
            target = "/".join(parts)
            if target not in seen: pending.add(target)
    print("fetched", len(seen), "pending", len(pending), flush=True)
for path in ["frontend/src/exercise-names/zh.js", "frontend/src/instr/zh.js"]:
    seen[path] = fetch(path)
manifest = []
for path, raw in sorted(seen.items()):
    dest = ROOT / "upstream" / path.removeprefix("frontend/src/")
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = raw
    if path.endswith("/exercises-data.js"):
        lines = raw.decode().splitlines()
        data = json.loads(next(x.split("=", 1)[1] for x in lines if x.startswith("export const EXDB=")))
        for item in data:
            item.pop("img", None); item.pop("gif", None)
        content = (lines[0] + "\nexport const EXDB=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n" + next(x for x in lines if x.startswith("export const EXALIAS=")) + "\n").encode()
    if path.endswith("/progression.js"):
        code = content.decode()
        code = code.replace("const deloadAt = DELOAD_AFTER[policy] || 3", "const deloadAt = Number.isInteger(cfg.stallLimit) && cfg.stallLimit > 0 ? cfg.stallLimit : (DELOAD_AFTER[policy] || 3)")
        code = code.replace("ownedDeload(owned, weight, DELOAD_FACTOR) : deloadTo(weight, inc)", "ownedDeload(owned, weight, deloadFactorOf(cfg)) : deloadTo(weight, inc, deloadFactorOf(cfg))")
        code = code.replace("deloadTo(last.goal || cfg.sec || 0, 5)", "deloadTo(last.goal || cfg.sec || 0, 5, deloadFactorOf(cfg))")
        content = code.encode()
    dest.write_bytes(content)
    manifest.append({"path": path, "upstreamSha256": hashlib.sha256(raw).hexdigest(), "localSha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "modified": content != raw})
(ROOT / "upstream-manifest.json").write_text(json.dumps({"repository": "https://github.com/DuarteSantos8/openGym", "commit": SHA, "files": manifest}, indent=2) + "\n")
for path in ["LICENSE", "NOTICE.md"]:
    raw = subprocess.check_output(["gh", "api", f"repos/DuarteSantos8/openGym/contents/{path}?ref={SHA}", "-H", "Accept: application/vnd.github.raw+json"])
    (ROOT / ("LICENSE" if path == "LICENSE" else "UPSTREAM-NOTICE.md")).write_bytes(raw)
print("done", len(manifest), "text source files")
