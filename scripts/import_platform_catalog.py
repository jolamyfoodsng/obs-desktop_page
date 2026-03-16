#!/usr/bin/env python3

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
  sys.path.insert(0, str(SCRIPT_DIR))

import import_obs_resources as obs_import

GITHUB_API_BASE = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"

RESOURCE_TYPE_BY_CATEGORY = {
  "Plugins": "plugin",
  "Scripts": "script",
  "Tools": "tool",
  "Themes": "theme",
  "Overlays": "overlay",
  "Guides": "guide_only",
}

DEFAULT_GITHUB_PLATFORMS = ["windows", "macos", "linux"]


def github_api_get(path: str) -> dict[str, Any] | list[Any] | None:
  url = path if path.startswith("http") else f"{GITHUB_API_BASE}{path}"
  headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "OBSDesktopCatalogBot/1.0",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  }
  token = os.environ.get("GITHUB_TOKEN")
  if token:
    headers["Authorization"] = f"Bearer {token}"

  request = Request(url, headers=headers)
  try:
    with urlopen(request, timeout=30) as response:
      return json.loads(response.read().decode("utf-8"))
  except HTTPError as error:
    if error.code == 404:
      return None
    raise
  except URLError as error:
    raise RuntimeError(f"Could not load GitHub API path {path}: {error}") from error


def canonical_display_category(value: str) -> str:
  if value.startswith("Guides"):
    return "Guides"
  return value


def infer_resource_type(entry: dict[str, Any], fallback: str | None = None) -> str:
  if fallback:
    return fallback

  category = canonical_display_category(entry.get("category", ""))
  mapped = RESOURCE_TYPE_BY_CATEGORY.get(category)
  if mapped:
    return mapped

  haystack = " ".join(
    filter(
      None,
      [
        entry.get("name", ""),
        entry.get("tagline", ""),
        entry.get("description", ""),
        entry.get("longDescription", ""),
      ],
    )
  ).lower()

  if "overlay" in haystack or "browser source" in haystack:
    return "overlay"
  return "guide_only"


def normalize_url(value: str | None) -> str | None:
  if not value:
    return None
  return value.strip().rstrip("/").lower()


def extract_github_repo(value: str | None) -> str | None:
  if not value:
    return None

  match = re.search(r"github\.com/([^/\s]+)/([^/\s?#]+)", value)
  if not match:
    return None
  owner = match.group(1)
  repo = match.group(2).removesuffix(".git")
  return f"{owner}/{repo}"


def github_repo_url(repo: str | None) -> str | None:
  return f"https://github.com/{repo}" if repo else None


def github_release_url(repo: str | None) -> str | None:
  return f"https://github.com/{repo}/releases" if repo else None


def infer_file_type(value: str | None) -> str | None:
  lower = (value or "").lower()
  if lower.endswith(".tar.gz"):
    return "tar.gz"
  if lower.endswith(".tar.xz"):
    return "tar.xz"
  if lower.endswith(".appimage"):
    return "appimage"
  if lower.endswith(".dmg"):
    return "dmg"
  if lower.endswith(".pkg"):
    return "pkg"
  if lower.endswith(".msi"):
    return "msi"
  if lower.endswith(".exe"):
    return "exe"
  if lower.endswith(".deb"):
    return "deb"
  if lower.endswith(".rpm"):
    return "rpm"
  if lower.endswith(".zip"):
    return "zip"
  if lower.endswith(".lua"):
    return "lua"
  if lower.endswith(".py"):
    return "py"
  if lower.startswith("http://") or lower.startswith("https://"):
    return "url"
  return None


def infer_install_type(file_type: str | None) -> str:
  if file_type in {"zip", "tar.gz", "tar.xz", "lua", "py"}:
    return "archive"
  if file_type in {"exe", "msi", "pkg", "dmg", "deb", "rpm", "appimage"}:
    return "external"
  return "guide"


def detect_asset_platforms(filename: str, file_type: str | None) -> list[str]:
  lower = filename.lower()
  platforms: list[str] = []

  if any(token in lower for token in ("windows", "win32", "win64", "win-", "_win", "x64", "64bit", ".exe", ".msi")):
    platforms.append("windows")

  if any(token in lower for token in ("macos", "mac", "osx", "darwin", "universal", ".dmg", ".pkg")):
    if "windows" not in platforms:
      platforms.append("macos")

  if any(token in lower for token in ("linux", "appimage", ".deb", ".rpm", "ubuntu", "wayland")):
    if "linux" not in platforms:
      platforms.append("linux")

  if not platforms:
    if file_type in {"exe", "msi"}:
      platforms.append("windows")
    elif file_type in {"dmg", "pkg"}:
      platforms.append("macos")
    elif file_type in {"appimage", "deb", "rpm"}:
      platforms.append("linux")

  return platforms


def asset_priority(file_type: str | None) -> int:
  if file_type in {"exe", "msi", "pkg", "dmg", "deb", "rpm", "appimage"}:
    return 0
  if file_type in {"zip", "tar.gz", "tar.xz"}:
    return 1
  if file_type in {"lua", "py"}:
    return 2
  return 3


def classify_release_assets(release: dict[str, Any] | None) -> dict[str, Any]:
  if not release:
    return {
      "supportedPlatforms": [],
      "fileType": "url",
      "installType": "guide",
      "releaseUrl": None,
      "selectedAssetName": None,
    }

  assets = release.get("assets") or []
  detected_platforms: list[str] = []
  selected_asset: dict[str, Any] | None = None

  for asset in assets:
    name = asset.get("name", "")
    file_type = infer_file_type(name)
    if file_type is None:
      continue
    asset_platforms = detect_asset_platforms(name, file_type)
    for platform in asset_platforms:
      if platform not in detected_platforms:
        detected_platforms.append(platform)

    if selected_asset is None:
      selected_asset = asset | {"_fileType": file_type}
      continue

    current_priority = asset_priority(selected_asset.get("_fileType"))
    candidate_priority = asset_priority(file_type)
    if candidate_priority < current_priority:
      selected_asset = asset | {"_fileType": file_type}

  selected_file_type = selected_asset.get("_fileType") if selected_asset else "url"
  return {
    "supportedPlatforms": detected_platforms,
    "fileType": selected_file_type,
    "installType": infer_install_type(selected_file_type),
    "releaseUrl": release.get("html_url"),
    "selectedAssetName": selected_asset.get("name") if selected_asset else None,
  }


def build_search_tags(*values: Any) -> list[str]:
  seen: set[str] = set()
  tags: list[str] = []

  for value in values:
    if value is None:
      continue
    if isinstance(value, (list, tuple, set)):
      nested = build_search_tags(*value)
      for tag in nested:
        if tag not in seen:
          seen.add(tag)
          tags.append(tag)
      continue

    tokens = re.findall(r"[a-z0-9][a-z0-9.+-]*", str(value).lower())
    for token in tokens:
      if len(token) < 2 or token in seen:
        continue
      seen.add(token)
      tags.append(token)

  return tags[:32]


def expand_compact_count(value: str | None) -> int | None:
  if not value:
    return None
  match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*([KMB])?\+?\s*", value.strip(), re.I)
  if not match:
    return None
  amount = float(match.group(1))
  suffix = (match.group(2) or "").upper()
  multiplier = {
    "": 1,
    "K": 1_000,
    "M": 1_000_000,
    "B": 1_000_000_000,
  }[suffix]
  return int(amount * multiplier)


def enrich_official_entry(entry: dict[str, Any]) -> dict[str, Any]:
  category = canonical_display_category(entry["category"])
  resource_type = infer_resource_type({**entry, "category": category})
  official_obs_url = entry["homepageUrl"] if "obsproject.com/forum/resources/" in entry["homepageUrl"] else None

  repo = (
    entry.get("githubRepo")
    or extract_github_repo(entry.get("sourceUrl"))
    or extract_github_repo(entry.get("manualInstallUrl"))
    or extract_github_repo(entry.get("homepageUrl"))
  )
  github_url = github_repo_url(repo)
  release_url = (
    entry.get("githubReleaseUrl")
    or (entry.get("sourceUrl") if "/releases" in (entry.get("sourceUrl") or "") else None)
    or github_release_url(repo)
  )
  file_type = infer_file_type(entry.get("manualInstallUrl")) or "url"

  entry["category"] = category
  entry["officialObsUrl"] = official_obs_url
  entry["githubUrl"] = github_url
  entry["releaseUrl"] = release_url
  entry["updatedAt"] = entry["lastUpdated"]
  entry["installType"] = "guide"
  entry["fileType"] = file_type
  entry["resourceType"] = resource_type
  entry["verifiedSource"] = "official-obs"
  entry["downloadCountRaw"] = entry.pop("_downloads", None) or expand_compact_count(entry.get("downloadCount"))
  entry["githubStars"] = None
  entry["searchTags"] = build_search_tags(
    entry["name"],
    entry["author"],
    entry["category"],
    resource_type,
    entry.get("sourceUrl"),
    entry.get("manualInstallUrl"),
  )

  if repo:
    entry["githubRepo"] = repo
  if release_url:
    entry["githubReleaseUrl"] = release_url

  return entry


def fetch_github_repo_snapshot(repo: str) -> dict[str, Any] | None:
  repo_data = github_api_get(f"/repos/{quote(repo, safe='/')}")
  if repo_data is None:
    return None
  release_data = github_api_get(f"/repos/{quote(repo, safe='/')}/releases/latest")
  return {
    "repo": repo_data,
    "release": release_data if isinstance(release_data, dict) else None,
  }


def build_github_entry(seed: dict[str, Any]) -> dict[str, Any] | None:
  repo_full_name = seed["repo"]
  snapshot = fetch_github_repo_snapshot(repo_full_name)
  if not snapshot:
    return None

  repo = snapshot["repo"]
  release = snapshot["release"]
  owner = repo.get("owner", {}).get("login", repo_full_name.split("/")[0])
  repo_name = repo.get("name", repo_full_name.split("/")[-1])
  repo_url = repo.get("html_url") or github_repo_url(repo_full_name)
  homepage_url = repo.get("homepage") or repo_url
  release_metadata = classify_release_assets(release)

  resource_type = seed.get("resourceType") or infer_resource_type(seed)
  category = seed.get("category", "Tools")
  supported_platforms = seed.get("supportedPlatforms") or release_metadata["supportedPlatforms"]
  if not supported_platforms and resource_type in {"overlay", "tool"}:
    supported_platforms = DEFAULT_GITHUB_PLATFORMS.copy()

  version = (
    (release or {}).get("tag_name")
    or (release or {}).get("name")
    or "Unreleased"
  )
  last_updated = (
    (release or {}).get("published_at")
    or repo.get("updated_at")
    or dt.datetime.now(dt.UTC).isoformat()
  )
  last_updated_date = last_updated.split("T")[0]
  download_count_raw = int(repo.get("stargazers_count") or 0)
  release_url = release_metadata["releaseUrl"] or github_release_url(repo_full_name)
  is_installable_release = (
    release_metadata["installType"] in {"archive", "external"}
    and bool(release_metadata["selectedAssetName"])
    and resource_type in {"plugin", "tool"}
  )

  title = repo.get("description") or repo_name.replace("-", " ").replace("_", " ")
  description = obs_import.summarize_description(title, title)
  accent_from, accent_to = obs_import.choose_accents(obs_import.slugify(repo_full_name.replace("/", "-")))
  name = seed.get("name") or repo_name

  return {
    "id": obs_import.slugify(repo_full_name.replace("/", "-")),
    "moduleName": obs_import.slugify(repo_name),
    "name": name,
    "tagline": description,
    "description": description,
    "longDescription": repo.get("description") or description,
    "author": owner,
    "version": version.lstrip("v") if isinstance(version, str) else "Unreleased",
    "supportedPlatforms": supported_platforms,
    "supportedOBSVersions": "See GitHub release notes",
    "minOBSVersion": "0.0.0",
    "maxOBSVersion": None,
    "category": category,
    "homepageUrl": homepage_url,
    "sourceUrl": repo_url,
    "githubRepo": repo_full_name,
    "githubReleaseUrl": release_url,
    "officialObsUrl": None,
    "githubUrl": repo_url,
    "releaseUrl": release_url,
    "updatedAt": last_updated,
    "installType": release_metadata["installType"],
    "fileType": release_metadata["fileType"],
    "resourceType": resource_type,
    "verifiedSource": "github-vetted",
    "downloadCountRaw": download_count_raw,
    "githubStars": download_count_raw,
    "iconKey": obs_import.choose_icon_key(name, category, f"{repo.get('description', '')} {' '.join(seed.get('tags', []))}"),
    "iconUrl": None,
    "screenshots": [],
    "installNotes": [
      "Imported from a vetted GitHub source because no matching official OBS resource page was cataloged.",
      "Review the repository and latest release notes before installing.",
      "This entry stays in the standard catalog schema without changing the existing install-selection logic.",
    ],
    "verified": owner.lower() == "obsproject",
    "featured": False,
    "guideOnly": not is_installable_release,
    "manualInstallUrl": release_url or repo_url,
    "statusNote": "Vetted GitHub source import",
    "lastUpdated": last_updated_date,
    "downloadCount": obs_import.format_compact_count(download_count_raw),
    "accentFrom": accent_from,
    "accentTo": accent_to,
    "packages": [],
    "searchTags": build_search_tags(
      name,
      owner,
      repo_full_name,
      category,
      resource_type,
      seed.get("tags", []),
      repo.get("description"),
    ),
  }


def collect_official_entries(
  minimum_age_days: int,
  curated_entries: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
  target_count = 5000
  all_items = obs_import.load_all_listing_items(target_count, minimum_age_days)
  selected_items = obs_import.select_candidates(all_items, target_count, minimum_age_days)

  imported_entries: list[dict[str, Any]] = []
  stats = {
    "listingItems": len(all_items),
    "selectedCandidates": len(selected_items),
    "duplicates": 0,
    "skipped": 0,
  }
  seen_ids = {entry["id"] for entry in curated_entries}

  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    future_map = {
      executor.submit(obs_import.build_resource_entry, item, curated_entries): item
      for item in selected_items
    }

    for index, future in enumerate(concurrent.futures.as_completed(future_map), start=1):
      entry = future.result()
      if not entry:
        stats["duplicates"] += 1
        continue
      if entry["id"] in seen_ids:
        stats["duplicates"] += 1
        continue
      seen_ids.add(entry["id"])
      imported_entries.append(enrich_official_entry(entry))
      if index % 25 == 0:
        print(
          f"Processed {index}/{len(future_map)} official resource detail pages",
          file=sys.stderr,
          flush=True,
        )

  imported_entries.sort(key=lambda entry: entry.get("downloadCountRaw") or 0, reverse=True)
  obs_import.set_featured_flags(imported_entries, 48)
  return imported_entries, stats


def load_existing_official_entries(resources_path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
  existing_entries = json.loads(resources_path.read_text())
  enriched_entries = [enrich_official_entry(dict(entry)) for entry in existing_entries]
  stats = {
    "listingItems": len(enriched_entries),
    "selectedCandidates": len(enriched_entries),
    "duplicates": 0,
    "skipped": 0,
  }
  return enriched_entries, stats


def identity_keys(entry: dict[str, Any]) -> dict[str, str | None]:
  return {
    "official": normalize_url(entry.get("officialObsUrl") or (entry.get("homepageUrl") if "obsproject.com/forum/resources/" in entry.get("homepageUrl", "") else None)),
    "source": normalize_url(entry.get("sourceUrl") or entry.get("githubUrl") or entry.get("homepageUrl")),
    "title": obs_import.normalize_name(entry.get("name", "")),
  }


def append_unique_entries(
  base_entries: list[dict[str, Any]],
  candidate_entries: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
  official_keys = {key["official"] for key in map(identity_keys, base_entries) if key["official"]}
  source_keys = {key["source"] for key in map(identity_keys, base_entries) if key["source"]}
  title_keys = {key["title"] for key in map(identity_keys, base_entries) if key["title"]}

  accepted: list[dict[str, Any]] = []
  stats = {"duplicates": 0, "skipped": 0}

  for entry in candidate_entries:
    if not entry:
      stats["skipped"] += 1
      continue

    keys = identity_keys(entry)
    if (
      (keys["official"] and keys["official"] in official_keys)
      or (keys["source"] and keys["source"] in source_keys)
      or (keys["title"] and keys["title"] in title_keys)
    ):
      stats["duplicates"] += 1
      continue

    if keys["official"]:
      official_keys.add(keys["official"])
    if keys["source"]:
      source_keys.add(keys["source"])
    if keys["title"]:
      title_keys.add(keys["title"])
    accepted.append(entry)

  return accepted, stats


def count_by_resource_type(entries: list[dict[str, Any]]) -> dict[str, int]:
  counts = {
    "plugin": 0,
    "script": 0,
    "tool": 0,
    "theme": 0,
    "overlay": 0,
    "guide_only": 0,
  }

  for entry in entries:
    resource_type = entry.get("resourceType") or infer_resource_type(entry)
    counts.setdefault(resource_type, 0)
    counts[resource_type] += 1

  return counts


def main() -> int:
  parser = argparse.ArgumentParser(
    description="Expand the OBS platform catalog using official OBS resources first, then vetted GitHub sources.",
  )
  parser.add_argument("--minimum-age-days", type=int, default=90)
  parser.add_argument("--curated-path", default="src/data/plugins.json")
  parser.add_argument("--resources-path", default="src/data/resources.json")
  parser.add_argument("--seed-path", default="scripts/vetted_obs_github_sources.json")
  parser.add_argument("--refresh-official", action="store_true")
  args = parser.parse_args()

  repo_root = Path(__file__).resolve().parents[1]
  curated_path = repo_root / args.curated_path
  resources_path = repo_root / args.resources_path
  seed_path = repo_root / args.seed_path

  curated_entries = json.loads(curated_path.read_text())
  github_seeds = json.loads(seed_path.read_text())

  if args.refresh_official:
    official_entries, official_stats = collect_official_entries(
      minimum_age_days=args.minimum_age_days,
      curated_entries=curated_entries,
    )
  else:
    official_entries, official_stats = load_existing_official_entries(resources_path)

  github_candidates = []
  for seed in github_seeds:
    github_candidates.append(build_github_entry(seed))

  github_entries, github_stats = append_unique_entries(official_entries, github_candidates)
  github_entries.sort(key=lambda entry: entry.get("downloadCountRaw") or 0, reverse=True)

  combined_entries = official_entries + github_entries
  resources_path.write_text(
    json.dumps(combined_entries, indent=2, ensure_ascii=False) + "\n"
  )

  resource_counts = count_by_resource_type(combined_entries)
  installable_count = sum(1 for entry in combined_entries if not entry.get("guideOnly", True))
  guide_only_count = sum(1 for entry in combined_entries if entry.get("guideOnly", False))

  summary = {
    "officialImported": len(official_entries),
    "githubImported": len(github_entries),
    "imported": len(combined_entries),
    "skipped": official_stats["skipped"] + github_stats["skipped"],
    "duplicates": official_stats["duplicates"] + github_stats["duplicates"],
    "installable": installable_count,
    "guideOnly": guide_only_count,
    "plugins": resource_counts.get("plugin", 0),
    "scripts": resource_counts.get("script", 0),
    "tools": resource_counts.get("tool", 0),
    "themes": resource_counts.get("theme", 0),
    "overlays": resource_counts.get("overlay", 0),
    "guide_only": resource_counts.get("guide_only", 0),
    "officialListingItems": official_stats["listingItems"],
    "officialSelectedCandidates": official_stats["selectedCandidates"],
  }

  print(json.dumps(summary, indent=2))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
