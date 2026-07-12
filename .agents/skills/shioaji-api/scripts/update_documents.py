#!/usr/bin/env python3
"""Mirror the official Shioaji LLM documentation for offline skill use."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

DEFAULT_INDEX_URL = "https://sinotrade.github.io/llms.txt"
ALLOWED_HOST = "sinotrade.github.io"
DOCS_PREFIX = "/zh/"
LINK_PATTERN = re.compile(
    r"\[[^\]]+\]\((https://sinotrade\.github\.io/zh/[^)\s]+\.md)\)"
)
USER_AGENT = "Rabang-Shioaji-Skill-Docs-Updater/1.0"


def download(url: str, timeout: float, retries: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status} for {url}")
                return response.read()
        except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
            if attempt == retries:
                raise RuntimeError(
                    f"Failed to download {url}: {error}"
                ) from error
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def document_path(url: str) -> Path:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST:
        raise ValueError(f"Unsupported document URL: {url}")
    if (
        parsed.query
        or parsed.fragment
        or not parsed.path.startswith(DOCS_PREFIX)
        or not parsed.path.endswith(".md")
    ):
        raise ValueError(f"Invalid document URL: {url}")

    relative = urllib.parse.unquote(parsed.path.lstrip("/"))
    parts = PurePosixPath(relative).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"Unsafe document path: {url}")
    return Path(*parts)


def write_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def parse_document_urls(index: str) -> list[str]:
    urls = sorted(set(LINK_PATTERN.findall(index)))
    if not urls:
        raise RuntimeError(
            "The official index contains no supported document links"
        )
    for url in urls:
        document_path(url)
    return urls


def load_previous_files(manifest_path: Path) -> set[Path]:
    if not manifest_path.exists():
        return set()
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        paths = set()
        for item in data.get("documents", []):
            raw_path = item["path"]
            if not isinstance(raw_path, str) or "\\" in raw_path:
                raise ValueError(
                    f"Unsafe document path in manifest: {raw_path!r}"
                )
            pure_path = PurePosixPath(raw_path)
            if (
                not pure_path.parts
                or pure_path.is_absolute()
                or any(
                    part in {"", ".", ".."}
                    for part in pure_path.parts
                )
            ):
                raise ValueError(
                    f"Unsafe document path in manifest: {raw_path!r}"
                )
            paths.add(Path(*pure_path.parts))
        return paths
    except (json.JSONDecodeError, KeyError, TypeError):
        return set()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index-url", default=DEFAULT_INDEX_URL)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    skill_dir = Path(__file__).resolve().parent.parent
    references_dir = skill_dir / "references"
    docs_dir = references_dir / "docs"
    index_path = references_dir / "llms.txt"
    manifest_path = references_dir / "manifest.json"

    print(f"Downloading index: {args.index_url}")
    index_bytes = download(args.index_url, args.timeout, args.retries)
    try:
        index_text = index_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError(
            "The official index is not valid UTF-8"
        ) from error
    urls = parse_document_urls(index_text)
    print(f"Downloading {len(urls)} documents...")

    downloaded: dict[str, bytes] = {}
    with ThreadPoolExecutor(
        max_workers=max(1, args.workers)
    ) as executor:
        jobs = {
            executor.submit(
                download,
                url,
                args.timeout,
                args.retries,
            ): url
            for url in urls
        }
        for completed, future in enumerate(
            as_completed(jobs),
            start=1,
        ):
            url = jobs[future]
            downloaded[url] = future.result()
            if completed % 25 == 0 or completed == len(jobs):
                print(f"Downloaded {completed}/{len(jobs)}")

    documents = []
    current_files: set[Path] = set()
    for url in urls:
        relative = document_path(url)
        content = downloaded[url]
        write_atomic(docs_dir / relative, content)
        current_files.add(relative)
        documents.append(
            {
                "path": relative.as_posix(),
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
                "url": url,
            }
        )

    previous_files = load_previous_files(manifest_path)
    resolved_docs_dir = docs_dir.resolve()
    for stale in sorted(previous_files - current_files):
        stale_path = docs_dir / stale
        try:
            stale_path.resolve().relative_to(resolved_docs_dir)
        except ValueError as error:
            raise ValueError(
                f"Unsafe stale document path: {stale}"
            ) from error
        if stale_path.is_file():
            stale_path.unlink()

    for directory in sorted(docs_dir.rglob("*"), reverse=True):
        if directory.is_dir():
            try:
                directory.rmdir()
            except OSError:
                pass

    write_atomic(index_path, index_bytes)
    manifest = {
        "document_count": len(documents),
        "documents": documents,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "index_sha256": hashlib.sha256(index_bytes).hexdigest(),
        "source": args.index_url,
    }
    write_atomic(
        manifest_path,
        (
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        ).encode("utf-8"),
    )
    print(f"Updated offline documentation in {references_dir}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
