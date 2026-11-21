from dataclasses import dataclass
from datetime import date
import json
import lzma
from pathlib import Path
import re
from string import Formatter
from urllib.parse import urlsplit


class ValidationError(ValueError):
    pass


USERNAME = re.compile(r"[a-zA-Z0-9._]{1,30}\Z")
SHORTCODE = re.compile(r"[a-zA-Z0-9_-]{1,32}\Z")
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
SESSION_TARGETS = {"saved", "feed", "stories", "hashtag", "location", "followees"}
ACCOUNT_TARGETS = {"saved", "feed", "stories"}
TARGET_TYPES = {"profile", "post", "metadata"} | SESSION_TARGETS

FOLDER_FIELDS = {"target", "profile"}
FILE_FIELDS = FOLDER_FIELDS | {"date_utc", "date_local", "shortcode", "mediaid", "typename", "filename"}
TEXT_FIELDS = FILE_FIELDS - {"filename"} | {"caption", "pcaption", "caption_hashtags", "caption_mentions", "is_video"}
POST_FIELDS = TEXT_FIELDS - {"target"} | {"likes", "comments", "accessibility_caption", "title", "url", "video_url"}
STORY_FIELDS = TEXT_FIELDS | {"expiring_utc", "expiring_local", "url", "video_url"}
WINDOWS_NAMES = {"AUX", "CON", "NUL", "PRN"} | {f"{prefix}{i}" for prefix in ("COM", "LPT") for i in range(1, 10)}


def username(value: str) -> str:
    if not isinstance(value, str) or not USERNAME.fullmatch(value) or not value.strip("."):
        raise ValidationError("Enter a valid Instagram username.")
    return value.lower()


def shortcode(value: str) -> str:
    if not isinstance(value, str) or not SHORTCODE.fullmatch(value):
        raise ValidationError("Enter an Instagram post, Reel, or IGTV link or shortcode.")
    return value


def instagram_parts(value: str) -> list[str]:
    try:
        url = urlsplit(value if "://" in value else f"https://{value}")
        if url.scheme == "https" and url.netloc.lower() in INSTAGRAM_HOSTS:
            return [part for part in url.path.strip("/").split("/") if part]
    except ValueError:
        pass
    raise ValidationError("Enter an HTTPS link on instagram.com.")


def path_segment(value: str) -> str:
    if (not value or value.rstrip(" .") != value or value in {".", ".."}
            or value.partition(".")[0].upper() in WINDOWS_NAMES):
        raise ValidationError("Folder and filename templates must produce valid names.")
    return value


def validate_pattern(pattern: str, fields: set[str], *, kind: str) -> None:
    if not pattern:
        return
    date_fields = {"date_utc", "date_local", "expiring_utc", "expiring_local"}
    pattern_length = 4096 if kind == "text" else 180
    if len(pattern) > pattern_length:
        raise ValidationError(f"The {kind} template is too long.")
    literal_mask = []
    try:
        tokens = list(Formatter().parse(pattern))
    except ValueError as error:
        raise ValidationError(f"The {kind} template has unmatched braces.") from error
    for literal, field, spec, conversion in tokens:
        if kind != "text" and not re.fullmatch(r"[A-Za-z0-9 ._/-]*", literal):
            raise ValidationError(f"The {kind} template contains an unsupported path character.")
        literal_mask.append(literal)
        if field is None:
            continue
        if field not in fields or conversion:
            raise ValidationError(f"Unsupported field in {kind} template.")
        if spec and (field not in date_fields or not re.fullmatch(r"(?:%[YymdHMSj]|[A-Za-z0-9 ._-])+", spec)):
            raise ValidationError(f"Only safe date formats are supported in the {kind} template.")
        literal_mask.append("sample")
    if kind in {"folder", "file"}:
        parts = "".join(literal_mask).split("/")
        if kind == "file" and len(parts) > 1:
            raise ValidationError("Use the folder template to add subfolders.")
        for part in parts:
            path_segment(part)


def optional_date(value: str) -> date | None:
    if not value:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return date.fromisoformat(value)
    except ValueError:
        pass
    raise ValidationError("Dates must use YYYY-MM-DD.")


def normalize_target(target_type: str, value: str) -> str:
    is_url = "/" in value or ":" in value
    if target_type == "metadata":
        if not Path(value).is_absolute() or not value.lower().endswith((".json", ".json.xz")):
            raise ValidationError("Select an Instaloader .json or .json.xz file.")
        return value
    parts = instagram_parts(value) if is_url else []
    if target_type in {"profile", "followees"}:
        return username(parts[0] if len(parts) == 1 else value.lstrip("@"))
    if target_type == "post":
        return shortcode(parts[1] if len(parts) == 2 and parts[0] in {"p", "reel", "reels", "tv"} else value)
    if target_type == "hashtag":
        name = parts[2] if len(parts) == 3 and parts[:2] == ["explore", "tags"] else value.removeprefix("#")
        if re.fullmatch(r"\w{1,100}", name):
            return name.lower()
        raise ValidationError("Enter a hashtag name or Instagram hashtag link.")
    if target_type == "location":
        identifier = parts[2] if len(parts) >= 3 and parts[:2] == ["explore", "locations"] else value.removeprefix("%")
        if re.fullmatch(r"[0-9]{1,24}", identifier):
            return identifier
        raise ValidationError("Enter a numeric location ID or Instagram location link.")
    raise ValidationError("Choose a supported download target.")


@dataclass(frozen=True)
class Options:
    posts: bool
    profile_picture: bool
    stories: bool
    highlights: bool
    tagged: bool
    reels: bool
    igtv: bool
    photos: bool
    videos: bool
    thumbnails: bool
    captions: bool
    metadata: bool
    compress_metadata: bool
    comments: bool
    geotags: bool
    fast_update: bool
    resume: bool
    max_items: int | None
    since: date | None
    until: date | None
    caption_contains: str
    carousel: str
    folder_pattern: str
    file_pattern: str
    post_text_pattern: str
    story_text_pattern: str

    @classmethod
    def parse(cls, data: dict) -> "Options":
        if not isinstance(data, dict):
            raise ValidationError("Invalid download options.")

        def boolean(name, default=False):
            value = data.get(name, default)
            if not isinstance(value, bool):
                raise ValidationError(f"Invalid setting for {name}.")
            return value

        def string(name):
            value = data.get(name, "")
            if not isinstance(value, str):
                raise ValidationError(f"Invalid setting for {name}.")
            return value.strip()

        since, until = optional_date(string("since")), optional_date(string("until"))
        if since and until and since > until:
            raise ValidationError("The start date must be on or before the end date.")
        max_items = data.get("maxItems")
        if max_items is not None and (type(max_items) is not int or max_items < 1):
            raise ValidationError("Set a positive item limit or leave it blank.")
        carousel = string("carousel").lower()
        if carousel == "all":
            carousel = ""
        if carousel and carousel != "last":
            if not re.fullmatch(r"[1-9][0-9]{0,2}(?:-(?:[1-9][0-9]{0,2}|last))?", carousel):
                raise ValidationError("Use all, last, a slide number, or a range like 1-3.")
            first, _, last = carousel.partition("-")
            if last.isdecimal() and int(last) <= int(first):
                raise ValidationError("The last slide must be after the first slide.")
        folder, filename = string("folderPattern"), string("filePattern")
        post_text, story_text = string("postTextPattern"), string("storyTextPattern")
        validate_pattern(folder, FOLDER_FIELDS, kind="folder")
        validate_pattern(filename, FILE_FIELDS, kind="file")
        validate_pattern(post_text, POST_FIELDS, kind="text")
        validate_pattern(story_text, STORY_FIELDS, kind="text")
        photos, videos, fast = boolean("photos", True), boolean("videos", True), boolean("fastUpdate")
        if fast and not photos:
            raise ValidationError("Fast update requires photo downloads.")
        return cls(
            posts=boolean("posts", True), profile_picture=boolean("profilePicture", True), stories=boolean("stories"),
            highlights=boolean("highlights"), tagged=boolean("tagged"), reels=boolean("reels"), igtv=boolean("igtv"),
            photos=photos, videos=videos, thumbnails=photos and boolean("thumbnails", True),
            captions=boolean("captions", True), metadata=boolean("metadata", True),
            compress_metadata=boolean("compressMetadata", True), comments=boolean("comments"), geotags=boolean("geotags"),
            fast_update=fast, resume=boolean("resume", True), max_items=max_items, since=since, until=until,
            caption_contains=string("captionContains").casefold(), carousel=carousel,
            folder_pattern=folder or "{target}", file_pattern=filename or "{date_utc}_UTC_{shortcode}",
            post_text_pattern=post_text, story_text_pattern=story_text,
        )


@dataclass(frozen=True)
class Job:
    target_type: str
    targets: tuple[str, ...]
    destination: Path
    use_session: bool
    options: Options

    @classmethod
    def parse(cls, data: dict) -> "Job":
        if not isinstance(data, dict):
            raise ValidationError("Invalid download request.")
        target_type, raw_targets = data.get("targetType"), data.get("targets")
        if not isinstance(target_type, str) or target_type not in TARGET_TYPES:
            raise ValidationError("Choose a supported download target.")
        if not isinstance(raw_targets, list) or any(not isinstance(t, str) for t in raw_targets):
            raise ValidationError("Enter valid download targets.")
        targets = tuple(dict.fromkeys(normalize_target(target_type, t.strip()) for t in raw_targets if t.strip())) \
            if target_type not in ACCOUNT_TARGETS else ()
        if not targets and target_type not in ACCOUNT_TARGETS:
            raise ValidationError("Enter at least one download target.")
        raw_destination = data.get("destination")
        if not isinstance(raw_destination, str) or not Path(raw_destination).is_absolute():
            raise ValidationError("Choose an absolute output folder.")
        use_session = data.get("useSession", False)
        if not isinstance(use_session, bool):
            raise ValidationError("Invalid session setting.")
        options = Options.parse(data.get("options", {}))
        if not use_session and (target_type in SESSION_TARGETS or options.stories or options.highlights
                                or options.geotags or options.comments):
            raise ValidationError("Sign in to use the selected target or options.")
        if target_type in {"profile", "followees"} and not any((
                options.posts, options.profile_picture, options.stories, options.highlights, options.tagged,
                options.reels, options.igtv, options.metadata)):
            raise ValidationError("Choose at least one profile download option.")
        return cls(target_type, targets, Path(raw_destination).resolve(), use_session, options)


def metadata_reference(filename: str) -> tuple[str, str | int]:
    """Use archived identifiers as references and fetch current server-side metadata."""
    opener = lzma.open if filename.lower().endswith(".xz") else open
    try:
        with opener(filename, "rt", encoding="utf-8") as stream:
            data = json.loads(stream.read(16 * 1024 * 1024))
        header = data.get("instaloader") or {}
        kind = header.get("node_type", "Post")
        node = data.get("node", data)
        if kind == "Post":
            return kind, shortcode(node.get("shortcode"))
        if kind == "StoryItem" and re.fullmatch(r"[1-9][0-9]{0,19}", str(node.get("id"))):
            return kind, int(node["id"])
    except (OSError, ValueError, AttributeError, TypeError, EOFError, lzma.LZMAError) as error:
        raise ValidationError("Could not read media identifiers from the metadata file.") from error
    raise ValidationError("Select a metadata file for a post or story item.")


def safe_media_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443):
            return False
        return any(url.hostname == suffix or url.hostname.endswith(f".{suffix}")
                   for suffix in ("cdninstagram.com", "fbcdn.net", "fbsbx.com"))
    except (TypeError, ValueError):
        return False
