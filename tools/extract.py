#!/usr/bin/env python3
import argparse, json, pathlib, re

SRC_DEFAULT = "~/Documents/claude/Research/***REMOVED***.html"
TPL_RE = re.compile(r'<script type="text/html" id="tpl-([\w-]+)">(.*?)</script>', re.S)
CH_ROW = re.compile(r"\{id:'([\w-]+)',\s*part:'([^']*)',\s*num:'([^']*)',\s*title:'([^']*)',\s*short:'([^']*)'\}")

def extract_chapters(src: str) -> dict:
    return {cid: body.strip() + "\n" for cid, body in TPL_RE.findall(src) if cid != "home"}

def registry(src: str):
    block = src[src.find("const CH = ["): src.find("];", src.find("const CH = ["))]
    return [dict(zip(("id","part","num","title","short"), m)) for m in CH_ROW.findall(block)]

def build_manifest(src: str) -> dict:
    parts, order = {}, []
    for row in registry(src):
        if row["id"] == "home": continue
        key = row["part"] or "Phụ lục"
        if key not in parts: parts[key] = []; order.append(key)
        parts[key].append({"id": row["id"], "num": row["num"], "title": row["title"],
                           "short": row["short"], "file": f"chapters/{row['id']}.html"})
    return {"id": "***REMOVED***", "title": "***REMOVED***",
            "description": "Từ tiên đề Shannon đến định lượng bất định trong LLM",
            "lang": "vi", "version": "1.0.0", "runtime": "^1",
            "parts": [{"title": k, "chapters": parts[k]} for k in order]}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--source", default=SRC_DEFAULT); ap.add_argument("--out", default=".")
    a = ap.parse_args()
    src = pathlib.Path(a.source).expanduser().read_text(encoding="utf-8")
    root = pathlib.Path(a.out) / "courses" / "***REMOVED***"
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    for cid, frag in extract_chapters(src).items():
        (root / "chapters" / f"{cid}.html").write_text(frag, encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps(build_manifest(src), ensure_ascii=False, indent=2), encoding="utf-8")
    print("extracted:", len(extract_chapters(src)), "chapters")

if __name__ == "__main__": main()
