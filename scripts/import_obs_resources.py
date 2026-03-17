#!/usr/bin/env python3

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import io
import json
import re
import sys
import threading
import time
import tarfile
import zipfile
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE_URL = "https://obsproject.com"
LIST_URL = BASE_URL + "/forum/resources/?direction=desc&order=download_count&page={page}"
USER_AGENT = "Mozilla/5.0 (compatible; OBSDesktopCatalogBot/1.0)"
REQUEST_DELAY_SECONDS = 0.05
MIN_REQUEST_INTERVAL_SECONDS = 0.35
RESOURCE_MARKER = '<div class="structItem structItem--resource'

CATEGORY_LABELS = {
  "OBS Studio Plugins": "Plugins",
  "Scripts": "Scripts",
  "Tools": "Tools",
  "Themes": "Themes",
  "Guides (General)": "Guides",
  "Guides (Live Events)": "Guides",
}

RESOURCE_INSTALL_TYPES = {
  "native_plugin",
  "script_file",
  "external_installer",
  "zip_extract",
  "browser_source_bundle",
  "dock_bundle",
  "theme_bundle",
  "manual_guide",
}

GENERIC_NAME_WORDS = {
  "a",
  "an",
  "and",
  "for",
  "in",
  "obs",
  "plugin",
  "plugins",
  "resource",
  "resources",
  "studio",
  "the",
}

ACCENT_PAIRS = [
  ("#0ea5e9", "#2563eb"),
  ("#10b981", "#059669"),
  ("#f97316", "#ef4444"),
  ("#f59e0b", "#d97706"),
  ("#22c55e", "#14b8a6"),
  ("#ec4899", "#8b5cf6"),
  ("#6366f1", "#0ea5e9"),
  ("#84cc16", "#16a34a"),
  ("#ef4444", "#f97316"),
  ("#06b6d4", "#3b82f6"),
]

REQUEST_LOCK = threading.Lock()
LAST_REQUEST_AT = 0.0


def fetch_text(url: str) -> str:
  global LAST_REQUEST_AT

  last_error: Exception | None = None
  for attempt in range(5):
    try:
      with REQUEST_LOCK:
        now = time.monotonic()
        wait_time = max(0.0, LAST_REQUEST_AT + MIN_REQUEST_INTERVAL_SECONDS - now)
        if wait_time:
          time.sleep(wait_time)
        LAST_REQUEST_AT = time.monotonic()

      request = Request(url, headers={"User-Agent": USER_AGENT})
      with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", "ignore")
      time.sleep(REQUEST_DELAY_SECONDS)
      return body
    except HTTPError as error:
      last_error = error
      if error.code not in {429, 500, 502, 503, 504} or attempt == 4:
        raise
      retry_after = error.headers.get("Retry-After")
      delay = float(retry_after) if retry_after else 2 ** attempt
      print(
        f"Retrying {url} after HTTP {error.code} (attempt {attempt + 1}/5)",
        file=sys.stderr,
        flush=True,
      )
      time.sleep(delay)
    except URLError as error:
      last_error = error
      if attempt == 4:
        raise
      time.sleep(2 ** attempt)

  if last_error:
    raise last_error
  raise RuntimeError(f"Could not fetch {url}")


def collapse_whitespace(value: str) -> str:
  return re.sub(r"\s+", " ", value).strip()


def strip_tags(value: str) -> str:
  value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
  value = re.sub(r"</p>", "\n\n", value, flags=re.I)
  value = re.sub(r"<[^>]+>", " ", value)
  return html.unescape(re.sub(r"[ \t]+\n", "\n", value)).strip()


def trim_paragraphs(value: str, max_length: int) -> str:
  paragraphs = [collapse_whitespace(part) for part in value.splitlines() if collapse_whitespace(part)]
  if not paragraphs:
    return ""

  joined = "\n\n".join(paragraphs[:3])
  if len(joined) <= max_length:
    return joined
  return joined[: max_length - 1].rstrip() + "…"


def summarize_description(tagline: str, description: str) -> str:
  base = collapse_whitespace(tagline or description)
  if len(base) <= 190:
    return base
  return base[:189].rstrip() + "…"


def parse_int(value: str) -> int:
  digits = re.sub(r"[^0-9]", "", value or "")
  return int(digits) if digits else 0


def format_compact_count(value: int) -> str:
  if value >= 1_000_000:
    return f"{value / 1_000_000:.1f}M"
  if value >= 1_000:
    return f"{value / 1_000:.1f}K"
  return str(value)


def singularize(token: str) -> str:
  if token.endswith("ies") and len(token) > 4:
    return token[:-3] + "y"
  if token.endswith("s") and len(token) > 4:
    return token[:-1]
  return token


def normalize_name(value: str) -> str:
  tokens = [
    singularize(token)
    for token in re.findall(r"[a-z0-9]+", value.lower())
    if token not in GENERIC_NAME_WORDS
  ]
  return "".join(tokens)


def slugify(value: str) -> str:
  slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
  return slug or "obs-resource"


def normalize_category(value: str) -> str:
  return CATEGORY_LABELS.get(value, value)


def choose_icon_key(name: str, category: str, text: str) -> str:
  tokens = set(re.findall(r"[a-z0-9]+", f"{name} {category} {text}".lower()))
  if tokens.intersection({"transition", "transitions", "motion", "animate", "animation", "move"}):
    return "motion"
  if tokens.intersection({"switcher", "macro", "macros", "automation", "scheduler"}):
    return "automation"
  if tokens.intersection({"stream", "streaming", "output", "outputs", "rtmp", "ndi", "broadcast"}):
    return "broadcast"
  if tokens.intersection({"music", "audio", "sound", "midi", "volume"}):
    return "music"
  if tokens.intersection({"effect", "effects", "filter", "filters", "shader", "shaders", "mask", "blur"}):
    return "effects"
  if category == "Scripts":
    return "automation"
  if category == "Tools":
    return "motion"
  if category == "Guides":
    return "broadcast"
  return "effects"


def choose_accents(resource_id: str) -> tuple[str, str]:
  digest = hashlib.sha1(resource_id.encode("utf-8")).digest()[0]
  return ACCENT_PAIRS[digest % len(ACCENT_PAIRS)]


def iso_date_from_timestamp(value: str | int | None) -> str:
  if value is None:
    return dt.date.today().isoformat()
  timestamp = int(value)
  return dt.datetime.fromtimestamp(timestamp, dt.UTC).date().isoformat()


def iter_resource_blocks(page_html: str) -> list[str]:
  blocks: list[str] = []
  start = 0
  div_pattern = re.compile(r"</?div\b", re.I)

  while True:
    index = page_html.find(RESOURCE_MARKER, start)
    if index == -1:
      break

    depth = 0
    end_index = -1
    for match in div_pattern.finditer(page_html, index):
      is_close = match.group().startswith("</")
      if is_close:
        depth -= 1
        if depth == 0:
          end_index = page_html.find(">", match.start()) + 1
          break
      else:
        depth += 1

    if end_index == -1:
      break

    blocks.append(page_html[index:end_index])
    start = end_index

  return blocks


def find_first(pattern: str, text: str) -> str | None:
  match = re.search(pattern, text, re.S)
  if not match:
    return None
  return match.group(1)


def parse_listing_item(block: str) -> dict[str, Any] | None:
  title_match = re.search(
    r'<div class="structItem-title">\s*.*?<a href="([^"]+)"[^>]*data-tp-primary="on">(.+?)</a>\s*(?:<span class="u-muted">([^<]+)</span>)?',
    block,
    re.S,
  )
  if not title_match:
    return None

  category_match = re.search(r"<li><a href=\"([^\"]+)\">([^<]+)</a></li>\s*</ul>", block)
  rating_match = re.search(r'title="([0-9.]+) star\(s\)".*?ratingStarsRow-text">\s*([0-9,]+)\s+ratings?', block, re.S)
  downloads = find_first(r"structItem-metaItem--downloads.*?<dd>([^<]+)</dd>", block) or "0"
  last_update = find_first(r"structItem-metaItem--lastUpdate.*?data-timestamp=\"([0-9]+)\"", block)
  created_at = find_first(r"structItem-startDate.*?data-timestamp=\"([0-9]+)\"", block)
  icon_src = find_first(r'<a href="/forum/resources/[^"]+" class="avatar [^"]*"><img src="([^"]+)"', block)

  return {
    "url": urljoin(BASE_URL, html.unescape(title_match.group(1))),
    "name": strip_tags(title_match.group(2)),
    "version": collapse_whitespace(html.unescape(title_match.group(3) or "")) or "Unknown",
    "author": html.unescape(find_first(r'data-author="([^"]+)"', block) or "Unknown"),
    "tagline": collapse_whitespace(strip_tags(find_first(r'<div class="structItem-resourceTagLine">(.*?)</div>', block) or "")),
    "category": normalize_category(category_match.group(2) if category_match else "Resources"),
    "downloads": parse_int(downloads),
    "download_label": collapse_whitespace(strip_tags(downloads)),
    "rating_value": float(rating_match.group(1)) if rating_match else 0.0,
    "rating_count": parse_int(rating_match.group(2)) if rating_match else 0,
    "created_at": int(created_at) if created_at else 0,
    "last_update": int(last_update) if last_update else int(created_at or 0),
    "featured": "structItem-status--featured" in block,
    "icon_url": urljoin(BASE_URL, icon_src) if icon_src else None,
  }


def parse_platforms(raw_values: list[str]) -> list[str]:
  platforms: list[str] = []
  for raw in raw_values:
    value = raw.lower()
    if "windows" in value and "windows" not in platforms:
      platforms.append("windows")
    if ("mac" in value or "osx" in value) and "macos" not in platforms:
      platforms.append("macos")
    if "linux" in value and "linux" not in platforms:
      platforms.append("linux")
  return platforms


def extract_custom_fields(page_html: str) -> dict[str, dict[str, Any]]:
  fields: dict[str, dict[str, Any]] = {}
  for field_id, label, dd_html in re.findall(
    r'<dl class="pairs pairs--columns pairs--fixedSmall pairs--customField" data-field="([^"]+)">\s*<dt>(.*?)</dt>\s*<dd>(.*?)</dd>\s*</dl>',
    page_html,
    re.S,
  ):
    raw_values = [collapse_whitespace(strip_tags(value)) for value in re.findall(r"<li>(.*?)</li>", dd_html, re.S)]
    if not raw_values:
      raw_values = [collapse_whitespace(strip_tags(dd_html))]
    urls = [html.unescape(url) for url in re.findall(r'href="([^"]+)"', dd_html)]
    fields[field_id] = {
      "label": collapse_whitespace(strip_tags(label)),
      "values": [value for value in raw_values if value],
      "urls": [urljoin(BASE_URL, url) for url in urls],
    }
  return fields


def extract_ldjson(page_html: str) -> dict[str, Any]:
  match = re.search(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', page_html, re.S)
  if not match:
    return {}
  return json.loads(match.group(1))


def extract_download_url(page_html: str) -> str | None:
  href = find_first(
    r'<a href="([^"]+)" class="button [^"]*button--cta[^"]*"[^>]*>\s*(?:.*?)<span class="button-text">(Download|Go to download)</span>',
    page_html,
  )
  if not href:
    return None
  return urljoin(BASE_URL, html.unescape(href))


def infer_package_type(value: str | None) -> str:
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
  return "unknown"


def filename_from_headers(download_url: str, headers: Any, fallback: str) -> str:
  disposition = headers.get("Content-Disposition", "")
  match = re.search(r'filename="?([^";]+)"?', disposition, re.I)
  if match:
    return html.unescape(match.group(1)).strip()
  return download_url.rstrip("/").split("/")[-1] or fallback


def inspect_archive_members(package_type: str, payload: bytes) -> list[str]:
  entries: list[str] = []
  if package_type == "zip":
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
      for member in archive.namelist():
        normalized = member.replace("\\", "/").strip("/")
        if normalized and not normalized.endswith("/"):
          entries.append(normalized)
  elif package_type in {"tar.gz", "tar.xz"}:
    mode = "r:gz" if package_type == "tar.gz" else "r:xz"
    with tarfile.open(fileobj=io.BytesIO(payload), mode=mode) as archive:
      for member in archive.getmembers():
        if member.isfile():
          normalized = member.name.replace("\\", "/").strip("/")
          if normalized:
            entries.append(normalized)
  return entries


def inspect_download_package(download_url: str, fallback_filename: str) -> dict[str, Any]:
  request = Request(download_url, headers={"User-Agent": USER_AGENT})
  with urlopen(request, timeout=30) as response:
    headers = response.headers
    filename = filename_from_headers(download_url, headers, fallback_filename)
    package_type = infer_package_type(filename)
    if package_type == "unknown":
      package_type = infer_package_type(download_url)

    content_length = int(headers.get("Content-Length", "0") or 0)
    should_read_archive = package_type in {"zip", "tar.gz", "tar.xz"} and (
      content_length == 0 or content_length <= 40 * 1024 * 1024
    )

    payload = response.read() if should_read_archive or package_type in {"lua", "py"} else b""
    archive_entries = inspect_archive_members(package_type, payload) if should_read_archive else []

  return {
    "filename": filename,
    "packageType": package_type,
    "archiveEntries": archive_entries,
  }


def dedupe_strings(values: list[str]) -> list[str]:
  seen: set[str] = set()
  unique: list[str] = []
  for value in values:
    candidate = collapse_whitespace(value)
    if not candidate:
      continue
    key = candidate.lower()
    if key in seen:
      continue
    seen.add(key)
    unique.append(candidate)
  return unique


def infer_platforms_from_text(text: str, existing: list[str]) -> list[str]:
  lower = text.lower()
  platforms = list(existing)
  if re.search(r"\bwindows[- ]only\b|\bonly works on windows\b|\bfor windows\b", lower):
    return ["windows"]
  if re.search(r"\bmac(?:os| os x)?[- ]only\b|\bonly works on mac", lower):
    return ["macos"]
  if re.search(r"\blinux[- ]only\b|\bonly works on linux\b", lower):
    return ["linux"]
  return platforms


def infer_resource_type(
  category: str,
  resource_install_type: str,
  text: str,
) -> str:
  lower = text.lower()

  if category == "Plugins":
    return "plugin"

  if category == "Themes":
    return "theme"

  if category == "Guides":
    return "guide"

  if resource_install_type == "dock_bundle":
    return "dock_extension"

  if resource_install_type == "browser_source_bundle":
    if any(token in lower for token in ("lower third", "overlay", "alert", "ticker", "stinger")):
      return "overlay_pack"
    return "browser_widget"

  if category == "Scripts" or resource_install_type == "script_file":
    if any(
      token in lower
      for token in (
        "automation",
        "integration",
        "connector",
        "companion",
        "home assistant",
        "websocket",
        "stream deck",
        "unreal",
      )
    ):
      return "automation_integration"
    return "script"

  if any(
    token in lower
    for token in (
      "overlay",
      "lower third",
      "lower thirds",
      "browser source",
      "widget",
      "ticker",
      "scoreboard",
    )
  ):
    return "overlay_pack"

  if any(
    token in lower
    for token in ("automation", "integration", "connector", "control panel", "bridge")
  ):
    return "automation_integration"

  return "tool"


def extract_install_instructions(text: str) -> list[str]:
  instructions: list[str] = []
  for raw_line in text.splitlines():
    line = collapse_whitespace(raw_line)
    if not line:
      continue
    if re.match(r"^(?:\d+[\).\:]|[-*•])\s+", line):
      instructions.append(re.sub(r"^(?:\d+[\).\:]|[-*•])\s+", "", line))

  if instructions:
    return dedupe_strings(instructions)[:8]

  paragraphs = [collapse_whitespace(part) for part in text.splitlines() if collapse_whitespace(part)]
  interesting = [
    paragraph for paragraph in paragraphs
    if any(
      token in paragraph.lower()
      for token in (
        "install",
        "setup",
        "browser source",
        "browser panels",
        "custom dock",
        "tools/scripts",
        "tools → scripts",
      )
    )
  ]
  return dedupe_strings(interesting)[:6]


def build_primary_entry_files(archive_entries: list[str], package_type: str) -> list[dict[str, str]]:
  if package_type in {"lua", "py"}:
    return []

  html_entries = [entry for entry in archive_entries if entry.lower().endswith(".html")]
  if not html_entries:
    return []

  prioritized: list[dict[str, str]] = []
  seen_roles: set[str] = set()
  for entry in html_entries:
    lower = entry.lower()
    if "control-panel" in lower or "control_panel" in lower:
      role = "control_panel"
      label = "Control panel"
    elif "browser-source" in lower or "browser_source" in lower:
      role = "browser_source"
      label = "Browser source"
    elif lower.endswith("index.html"):
      role = "entry"
      label = "Main HTML entry"
    else:
      role = f"html_{len(prioritized) + 1}"
      label = Path(entry).name

    if role in seen_roles:
      continue
    seen_roles.add(role)
    prioritized.append({
      "role": role,
      "label": label,
      "relativePath": entry,
    })

  return prioritized[:4]


def infer_resource_install_type(
  category: str,
  package_type: str,
  text: str,
  archive_entries: list[str],
  primary_entry_files: list[dict[str, str]],
) -> str:
  lower = text.lower()
  entry_names = [entry.lower() for entry in archive_entries]

  if package_type in {"exe", "msi", "pkg", "dmg", "deb", "rpm", "appimage"}:
    return "external_installer"

  if category == "Themes":
    return "theme_bundle" if package_type in {"zip", "tar.gz", "tar.xz"} else "manual_guide"

  if category == "Scripts" or package_type in {"lua", "py"} or any(
    entry.endswith(".lua") or entry.endswith(".py") for entry in entry_names
  ):
    return "script_file"

  has_control_panel = any(item["role"] == "control_panel" for item in primary_entry_files)
  has_browser_source = any(item["role"] == "browser_source" for item in primary_entry_files)

  if has_control_panel or "browser panels" in lower or "custom dock" in lower:
    return "dock_bundle"

  if has_browser_source or "browser source" in lower:
    return "browser_source_bundle"

  if package_type in {"zip", "tar.gz", "tar.xz"} and any(
    entry.startswith("obs-plugins/")
    or entry.startswith("data/")
    or entry.startswith("bin/")
    or "/obs-plugins/" in entry
    or "/data/" in entry
    or "/bin/" in entry
    for entry in entry_names
  ):
    return "native_plugin"

  if category == "Plugins" and package_type in {"zip", "tar.gz", "tar.xz"}:
    return "native_plugin"

  if package_type in {"zip", "tar.gz", "tar.xz"}:
    return "zip_extract"

  return "manual_guide"


def managed_extract_path(resource_id: str, resource_install_type: str) -> str | None:
  if resource_install_type == "script_file":
    return f"obs-scripts/{resource_id}"
  if resource_install_type in {"browser_source_bundle", "dock_bundle", "theme_bundle", "zip_extract"}:
    return f"managed-tools/{resource_id}"
  return None


def build_obs_followup_steps(
  resource_install_type: str,
  primary_entry_files: list[dict[str, str]],
) -> list[str]:
  steps: list[str] = []
  if resource_install_type in {"dock_bundle", "browser_source_bundle"}:
    control_panel = next((item for item in primary_entry_files if item["role"] == "control_panel"), None)
    browser_source = next((item for item in primary_entry_files if item["role"] == "browser_source"), None)
    if control_panel:
      steps.append(
        f'In OBS, open View -> Docks -> Custom Browser Docks and point it to the installed "{control_panel["relativePath"]}" file using a file:// URL.'
      )
    if browser_source:
      steps.append(
        f'Add a Browser Source in OBS and point it to the installed "{browser_source["relativePath"]}" file using a file:// URL.'
      )
  elif resource_install_type == "script_file":
    steps.append('In OBS, open Tools -> Scripts, click "+", and select the installed script file.')
  elif resource_install_type == "zip_extract":
    steps.append("Open the installed bundle folder and follow the resource-specific setup instructions in the plugin details page.")
  return steps


def build_setup_actions(
  resource_install_type: str,
  primary_entry_files: list[dict[str, str]],
) -> list[dict[str, Any]]:
  actions: list[dict[str, Any]] = []
  if resource_install_type == "dock_bundle":
    actions.append({
      "kind": "add_custom_dock",
      "label": "Add Custom Dock",
      "description": "Create an OBS custom browser dock that points to the installed control panel HTML file.",
      "entryRole": "control_panel",
    })
  if resource_install_type in {"dock_bundle", "browser_source_bundle"}:
    actions.append({
      "kind": "add_browser_source",
      "label": "Add Browser Source",
      "description": "Create an OBS Browser Source that points to the installed browser-source HTML file.",
      "entryRole": "browser_source",
    })
  if resource_install_type == "script_file":
    actions.append({
      "kind": "attach_script",
      "label": "Attach script in OBS",
      "description": 'Open OBS, go to Tools -> Scripts, click "+", and select the installed script file.',
      "entryRole": "script",
    })
  return actions


def looks_like_source_code(url: str) -> bool:
  return any(host in url for host in ("github.com", "gitlab.com", "bitbucket.org", "codeberg.org"))


def first_url_in_text(value: str) -> str | None:
  match = re.search(r"https?://[^\s)]+", value)
  return match.group(0) if match else None


def build_install_notes(
  listing: dict[str, Any],
  platforms: list[str],
  min_obs_version: str | None,
  source_url: str | None,
  resource_install_type: str,
  download_button_present: bool,
) -> list[str]:
  notes = [
    "Imported from the official OBS Forums Resources catalog.",
    "Use the official resource page to review install steps, release notes, and downloads.",
  ]

  if source_url:
    notes.append("A source code link was published on the official resource page.")

  if min_obs_version:
    notes.append(f"Minimum OBS version listed on the resource page: {min_obs_version}.")
  else:
    notes.append("OBS version compatibility was not explicitly listed on the resource page.")

  if not platforms:
    notes.append("Platform support was not explicitly listed on the resource page.")

  if listing["category"] != "Plugins":
    notes.append(f"This entry comes from the official {listing['category']} section, not the one-click curated install set.")

  if download_button_present and resource_install_type != "manual_guide":
    notes.append(f"The official download button was inspected and normalized as a {resource_install_type.replace('_', ' ')} resource.")

  return notes[:4]


def build_resource_entry(
  listing: dict[str, Any],
  curated_entries: list[dict[str, Any]],
  inspect_downloads: bool = False,
) -> dict[str, Any] | None:
  page_html = fetch_text(listing["url"])
  ldjson = extract_ldjson(page_html)
  entity = ldjson.get("mainEntity", {}) if isinstance(ldjson, dict) else {}
  fields = extract_custom_fields(page_html)
  download_url = extract_download_url(page_html)

  source_field = fields.get("source_code") or {}
  source_url = next((url for url in source_field.get("urls", []) if looks_like_source_code(url)), None)
  if not source_url:
    description_url = first_url_in_text(entity.get("description", ""))
    if description_url and looks_like_source_code(description_url):
      source_url = description_url

  raw_description = entity.get("description", "")
  supported_platforms = parse_platforms((fields.get("supp_platforms") or {}).get("values", []))
  supported_platforms = infer_platforms_from_text(raw_description, supported_platforms)
  min_obs_version = next(iter((fields.get("min_studio_ver") or {}).get("values", [])), None)
  supported_obs_versions = f"OBS {min_obs_version}+" if min_obs_version else "See official resource page"

  long_description = trim_paragraphs(raw_description, 900)
  tagline = collapse_whitespace(entity.get("alternativeHeadline", "")) or listing["tagline"] or summarize_description("", long_description)
  description = summarize_description(tagline, long_description)
  slug_source = listing["url"].rstrip("/").split("/")[-1].split(".")[0]
  resource_id = slugify(slug_source)
  accent_from, accent_to = choose_accents(resource_id)
  download_button_present = bool(download_url)
  package_type = infer_package_type(download_url or listing["url"])
  archive_entries: list[str] = []
  primary_entry_files: list[dict[str, str]] = []

  if inspect_downloads and download_url:
    try:
      inspection = inspect_download_package(download_url, resource_id)
      package_type = inspection["packageType"]
      archive_entries = inspection["archiveEntries"]
      primary_entry_files = build_primary_entry_files(archive_entries, package_type)
    except Exception:
      archive_entries = []
      primary_entry_files = []

  resource_install_type = infer_resource_install_type(
    listing["category"],
    package_type,
    f"{listing['name']} {listing['tagline']} {raw_description}",
    archive_entries,
    primary_entry_files,
  )
  resource_type = infer_resource_type(
    listing["category"],
    resource_install_type,
    f"{listing['name']} {listing['tagline']} {raw_description}",
  )
  obs_followup_steps = build_obs_followup_steps(resource_install_type, primary_entry_files)
  setup_actions = build_setup_actions(resource_install_type, primary_entry_files)
  install_instructions = extract_install_instructions(raw_description)
  guide_only = resource_install_type == "manual_guide"
  install_type = (
    "external" if resource_install_type == "external_installer"
    else "archive" if resource_install_type in {"native_plugin", "script_file", "zip_extract", "browser_source_bundle", "dock_bundle", "theme_bundle"}
    else "guide"
  )
  install_strategy = None
  if resource_install_type == "native_plugin":
    install_strategy = {
      "kind": "obs-plugin",
      "moduleNameAliases": [resource_id],
      "binaryNameHints": [],
      "resourceDirHints": [],
    }
  elif resource_install_type in {"browser_source_bundle", "dock_bundle", "theme_bundle", "zip_extract"}:
    install_strategy = {
      "kind": "standalone-tool",
      "moduleNameAliases": [resource_id],
      "binaryNameHints": [],
      "resourceDirHints": [],
    }

  current_name_key = normalize_name(entity.get("headline", listing["name"]))
  current_source_key = source_url or ""
  for curated in curated_entries:
    curated_name_key = normalize_name(curated.get("name", ""))
    curated_source = curated.get("sourceUrl") or curated.get("homepageUrl") or ""
    if current_name_key and current_name_key == curated_name_key:
      return None
    if current_source_key and curated_source and current_source_key == curated_source:
      return None

  verified = listing["downloads"] >= 10_000 and listing["rating_count"] >= 3 and listing["rating_value"] >= 4.0

  return {
    "_downloads": listing["downloads"],
    "id": resource_id,
    "moduleName": resource_id,
    "name": entity.get("headline", listing["name"]),
    "tagline": tagline,
    "description": description,
    "longDescription": long_description or description,
    "author": entity.get("author", {}).get("name", listing["author"]) if isinstance(entity.get("author"), dict) else listing["author"],
    "version": entity.get("version", listing["version"]) or "Unknown",
    "supportedPlatforms": supported_platforms,
    "supportedOBSVersions": supported_obs_versions,
    "minOBSVersion": min_obs_version or "0.0.0",
    "maxOBSVersion": None,
    "category": listing["category"],
    "homepageUrl": entity.get("url", listing["url"]),
    "sourceUrl": source_url,
    "iconKey": choose_icon_key(listing["name"], listing["category"], f"{listing['tagline']} {long_description}"),
    "iconUrl": listing["icon_url"],
    "screenshots": [],
    "installNotes": build_install_notes(
      listing,
      supported_platforms,
      min_obs_version,
      source_url,
      resource_install_type,
      download_button_present,
    ),
    "verified": verified,
    "featured": False,
    "guideOnly": guide_only,
    "downloadButtonPresent": download_button_present,
    "manualInstallUrl": download_url or entity.get("url", listing["url"]),
    "resourceType": resource_type,
    "resourceInstallType": resource_install_type,
    "packageType": package_type,
    "managedExtractPath": managed_extract_path(resource_id, resource_install_type),
    "primaryEntryFiles": primary_entry_files,
    "installInstructions": install_instructions,
    "obsFollowupSteps": obs_followup_steps,
    "setupActions": setup_actions,
    "statusNote": "Official OBS resource import",
    "lastUpdated": iso_date_from_timestamp(listing["last_update"]),
    "downloadCount": format_compact_count(listing["downloads"]),
    "accentFrom": accent_from,
    "accentTo": accent_to,
    "installType": install_type,
    "installStrategy": install_strategy,
    "fallbackInstallType": install_type if install_type in {"archive", "external", "guide"} else "guide",
    "packages": [],
  }


def load_curated_entries(path: Path) -> list[dict[str, Any]]:
  return json.loads(path.read_text())


def should_keep_for_stability(item: dict[str, Any], minimum_age_days: int, today: dt.date) -> bool:
  if not item["created_at"]:
    return False
  created_at = dt.datetime.fromtimestamp(item["created_at"], dt.UTC).date()
  return (today - created_at).days >= minimum_age_days


def select_candidates(all_items: list[dict[str, Any]], target_count: int, minimum_age_days: int) -> list[dict[str, Any]]:
  today = dt.date.today()
  stable = [item for item in all_items if should_keep_for_stability(item, minimum_age_days, today)]
  fallback = [item for item in all_items if item not in stable]

  seen_names: set[str] = set()
  selected: list[dict[str, Any]] = []

  for item in stable + fallback:
    name_key = normalize_name(item["name"])
    if name_key in seen_names:
      continue
    seen_names.add(name_key)
    selected.append(item)
    if len(selected) >= target_count:
      break

  return selected


def load_all_listing_items(target_candidates: int, minimum_age_days: int) -> list[dict[str, Any]]:
  items: list[dict[str, Any]] = []
  page = 1

  while True:
    print(f"Fetching listing page {page}", file=sys.stderr, flush=True)
    page_html = fetch_text(LIST_URL.format(page=page))
    blocks = iter_resource_blocks(page_html)
    if not blocks:
      break

    for block in blocks:
      item = parse_listing_item(block)
      if item:
        items.append(item)

    if len(select_candidates(items, target_candidates, minimum_age_days)) >= target_candidates:
      break

    if 'rel="next"' not in page_html:
      break

    page += 1
    time.sleep(REQUEST_DELAY_SECONDS)

  return items


def find_listing_item_by_url(target_url: str) -> dict[str, Any] | None:
  page = 1
  normalized_target = target_url.rstrip("/")

  while True:
    page_html = fetch_text(LIST_URL.format(page=page))
    blocks = iter_resource_blocks(page_html)
    if not blocks:
      return None

    for block in blocks:
      item = parse_listing_item(block)
      if item and item["url"].rstrip("/") == normalized_target:
        return item

    if 'rel="next"' not in page_html:
      return None

    page += 1
    time.sleep(REQUEST_DELAY_SECONDS)


def set_featured_flags(entries: list[dict[str, Any]], target_featured_count: int) -> None:
  featured_entries = 0
  for entry in entries:
    if featured_entries >= target_featured_count:
      break
    if entry["verified"]:
      entry["featured"] = True
      featured_entries += 1


def import_resources(target_count: int, minimum_age_days: int, curated_path: Path, output_path: Path) -> int:
  curated_entries = load_curated_entries(curated_path)
  candidate_buffer = min(100, max(10, target_count // 5))
  candidate_count = target_count + candidate_buffer
  all_items = load_all_listing_items(candidate_count, minimum_age_days)
  selected_items = select_candidates(all_items, candidate_count, minimum_age_days)
  print(
    f"Fetched {len(all_items)} listing items and selected {len(selected_items)} candidates",
    file=sys.stderr,
    flush=True,
  )

  imported_entries: list[dict[str, Any]] = []
  seen_ids = {entry["id"] for entry in curated_entries}

  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    future_map = {
      executor.submit(build_resource_entry, item, curated_entries): item
      for item in selected_items
    }
    for index, future in enumerate(concurrent.futures.as_completed(future_map), start=1):
      entry = future.result()
      if not entry or entry["id"] in seen_ids:
        continue
      seen_ids.add(entry["id"])
      imported_entries.append(entry)
      if index % 25 == 0:
        print(
          f"Processed {index}/{len(future_map)} resource detail pages",
          file=sys.stderr,
          flush=True,
        )

  imported_entries.sort(key=lambda entry: entry["_downloads"], reverse=True)
  imported_entries = imported_entries[:target_count]

  set_featured_flags(imported_entries, 48)
  for entry in imported_entries:
    entry.pop("_downloads", None)
  output_path.write_text(json.dumps(imported_entries, indent=2, ensure_ascii=False) + "\n")
  return len(imported_entries)


def main() -> int:
  parser = argparse.ArgumentParser(description="Import official OBS resources into the desktop catalog.")
  parser.add_argument("--target-count", type=int, default=995)
  parser.add_argument("--minimum-age-days", type=int, default=90)
  parser.add_argument("--curated-path", default="src/data/plugins.json")
  parser.add_argument("--output-path", default="src/data/resources.json")
  args = parser.parse_args()

  repo_root = Path(__file__).resolve().parents[1]
  curated_path = repo_root / args.curated_path
  output_path = repo_root / args.output_path

  try:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    imported_count = import_resources(
      target_count=args.target_count,
      minimum_age_days=args.minimum_age_days,
      curated_path=curated_path,
      output_path=output_path,
    )
  except Exception as error:  # pragma: no cover - importer failure should stay visible
    print(f"Importer failed: {error}", file=sys.stderr)
    return 1

  print(f"Wrote {imported_count} OBS resources to {output_path}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
