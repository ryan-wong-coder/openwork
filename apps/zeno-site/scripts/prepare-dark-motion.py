#!/usr/bin/env python3
"""Composite Zeno's existing paper-backed clips onto the website dark canvas.

Run with the pinned, disposable uv environment documented in
../motion-postproduction.md. This does not redraw or generate character frames.
"""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np


SITE = Path(__file__).resolve().parents[1]
BACKGROUND_RGB = (16, 38, 38)


def matte(frame):
    """Find the exterior only; bright regions enclosed by the otter stay solid."""
    height, width = frame.shape[:2]
    border = np.concatenate((frame[:12].reshape(-1, 3), frame[-12:].reshape(-1, 3),
                             frame[:, :12].reshape(-1, 3), frame[:, -12:].reshape(-1, 3)))
    paper = np.median(border, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - paper, axis=2)
    # Only paper-colored pixels connected to the canvas border are background.
    paper_candidate = (distance < 27).astype(np.uint8)
    _, labels = cv2.connectedComponents(paper_candidate, connectivity=8)
    edge_labels = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
    edge_labels = edge_labels[edge_labels != 0]
    exterior = np.isin(labels, edge_labels)
    foreground = (~exterior).astype(np.uint8) * 255
    contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("No connected character silhouette was found")
    contour = max(contours, key=cv2.contourArea)
    solid = np.zeros((height, width), dtype=np.uint8)
    cv2.drawContours(solid, [contour], -1, 255, thickness=cv2.FILLED)
    area = int(np.count_nonzero(solid))
    x, y, w, h = cv2.boundingRect(contour)
    if not (.10 < area / (height * width) < .55 and min(x, y) > 8 and x + w < width - 8 and y + h < height - 8):
        raise ValueError(f"Unexpected or clipped silhouette: {area=}, bounds={(x, y, w, h)}")
    # An inward subpixel feather removes the source paper fringe, rather than
    # blurring several pixels of bright background into the dark destination.
    inside = cv2.distanceTransform(solid, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    alpha = np.clip((inside - .65) / 1.0, 0, 1)
    # This assertion detects accidental holes: every eroded interior pixel must
    # remain completely opaque, including the pale face and belly.
    interior = cv2.erode(solid, np.ones((5, 5), np.uint8)) > 0
    if not np.all(alpha[interior] == 1):
        raise ValueError("The silhouette contains a transparent interior")
    return alpha, {"area": area, "bounds": [x, y, w, h], "paperBgr": paper.tolist()}


def composite(frame, alpha):
    background = np.full_like(frame, BACKGROUND_RGB[::-1])
    # The 1px matte edge is the only changed part of the character. Avoid keying
    # by color inside the silhouette so highlights retain their original RGB.
    return np.round(frame * alpha[..., None] + background * (1 - alpha[..., None])).astype(np.uint8)


def probe(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                             "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames,duration,color_space,color_transfer,color_primaries,color_range",
                             "-of", "json", str(path)], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)["streams"][0]


def prepare(name, assets, evidence):
    source = assets / f"{name}-v2.mp4"
    destination = assets / f"{name}-dark-v2.mp4"
    temporary = destination.with_name(f".{destination.stem}.processing.mp4")
    original = probe(source)
    if (original["width"], original["height"], original["r_frame_rate"]) != (800, 800, "24/1"):
        raise ValueError(f"Unexpected input media: {original}")
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError(f"Cannot decode {source}")
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    samples = {0, total // 4, total // 2, total * 3 // 4, total - 1}
    sheets, statistics = [], []
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "bgr24",
               "-video_size", "800x800", "-framerate", "24", "-i", "pipe:0", "-an",
               "-vf", "scale=out_color_matrix=bt709:out_range=tv,setparams=range=limited:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709", "-c:v", "libx264",
               "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
               "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-color_range", "tv",
               "-movflags", "+faststart", str(temporary)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for index in range(total):
            ok, frame = capture.read()
            if not ok:
                raise ValueError(f"Decoder stopped at frame {index}/{total}")
            alpha, stat = matte(frame)
            result = composite(frame, alpha)
            # Every original interior RGB is retained bit-for-bit before the
            # final H.264 compression. Pale highlights cannot become holes.
            opaque = alpha == 1
            if not np.array_equal(result[opaque], frame[opaque]):
                raise ValueError(f"Character interior changed in frame {index}")
            stat["frame"] = index
            statistics.append(stat)
            encoder.stdin.write(result.tobytes())
            if index in samples:
                cv2.imwrite(str(evidence / f"{name}-dark-frame-{index:03}.png"), result)
                thumb = cv2.resize(result, (320, 320), interpolation=cv2.INTER_AREA)
                cv2.putText(thumb, f"{index}/119  {index / 24:.2f}s", (10, 24), cv2.FONT_HERSHEY_SIMPLEX,
                            .5, (220, 231, 231), 1, cv2.LINE_AA)
                sheets.append(thumb)
        encoder.stdin.close()
        if encoder.wait(timeout=60) != 0:
            raise ValueError("H.264 encoding failed")
        output = probe(temporary)
        if (output["nb_frames"] != str(total) or output["codec_name"] != "h264" or output["pix_fmt"] != "yuv420p"
                or output["color_space"] != "bt709" or output["color_transfer"] != "iec61966-2-1" or output["color_range"] != "tv"):
            raise ValueError(f"Unexpected output media: {output}")
        temporary.replace(destination)
    except BaseException:
        if encoder.poll() is None:
            encoder.kill()
            encoder.wait()
        temporary.unlink(missing_ok=True)
        raise
    finally:
        capture.release()
    cv2.imwrite(str(evidence / f"{name}-dark-contact.png"), np.concatenate(sheets, axis=1))
    # Review decoded output too, so the contact sheet includes encoder losses.
    decoded = cv2.VideoCapture(str(destination))
    encoded_sheets = []
    for index in (0, total // 2, total - 1):
        decoded.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = decoded.read()
        if not ok:
            raise ValueError(f"Encoded output cannot decode frame {index}")
        encoded_sheets.append(cv2.resize(frame, (400, 400), interpolation=cv2.INTER_AREA))
    decoded.release()
    cv2.imwrite(str(evidence / f"{name}-dark-encoded-contact.png"), np.concatenate(encoded_sheets, axis=1))
    return {"source": source.name, "destination": destination.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "outputSha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "bytes": destination.stat().st_size,
            "video": output, "frames": statistics, "opaqueInteriorRgbUnchanged": True,
            "interiorHoles": 0, "backgroundRgbBeforeEncoding": list(BACKGROUND_RGB)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, default=SITE / "verification/v2-local/dark-postproduction")
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=True)
    report = {"method": "Border-connected paper segmentation, filled largest exterior contour, 1px inward feather",
              "aiPostprocessing": False, "opencv": cv2.__version__, "numpy": np.__version__, "clips": []}
    for name in ("welcome", "nod"):
        report["clips"].append(prepare(name, SITE / "public/assets/motion-v2", args.evidence))
    (args.evidence / "postproduction.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"clips": [{"name": c["destination"], "bytes": c["bytes"], "frames": len(c["frames"]),
                                 "interiorHoles": c["interiorHoles"]} for c in report["clips"]]}))


if __name__ == "__main__":
    main()
