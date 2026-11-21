from contextlib import contextmanager, suppress
from dataclasses import asdict
from hashlib import sha256
import json
import lzma
from pathlib import Path
import re
from tempfile import NamedTemporaryFile

import instaloader as il
from instaloader.exceptions import (
    BadCredentialsException, BadResponseException, ConnectionException, InstaloaderException, LoginRequiredException,
    PostChangedException, PrivateProfileNotFollowedException, ProfileNotExistsException,
    QueryReturnedForbiddenException, QueryReturnedNotFoundException,
)
from instaloader.instaloader import _ArbitraryItemFormatter
from requests import RequestException, Response

from engine.options import Job, ValidationError, metadata_reference, path_segment, safe_media_url, shortcode, username


def friendly_error(error):
    if isinstance(error, (ValidationError, PrivateProfileNotFollowedException)):
        return str(error)
    if isinstance(error, LoginRequiredException):
        return "This content requires an Instagram account with permission to view it."
    if isinstance(error, BadCredentialsException):
        return "Instagram rejected the sign-in details. Check your credentials and try again."
    if isinstance(error, (ProfileNotExistsException, QueryReturnedNotFoundException)):
        return "Instagram could not find the selected content. It may have been removed or made unavailable."
    if isinstance(error, QueryReturnedForbiddenException):
        return "Instagram denied access to this content. Check the account’s permissions."
    if isinstance(error, (ConnectionException, RequestException)):
        err_str = str(error).casefold()
        if re.search(r"\b(401|403)\b", err_str):
            return "Instagram refused this request. Check that you can view the content in your browser."
        if "429" in err_str or "too many requests" in err_str:
            return "Instagram rate limit reached. Pausing download to avoid restrictions."
        return "Could not retrieve this content from Instagram. Check your connection or session and try again."
    if isinstance(error, PermissionError):
        return "The output folder is read-only or a file is in use. Choose another folder or close the file."
    if isinstance(error, OSError):
        return "A local file could not be written. Check the output folder, path length, and available disk space."
    return "Instagram did not return data in a supported format for this content."


# Instagram requires web_api=True for GraphQL endpoints in modern versions
_orig_doc_id_graphql_query = il.InstaloaderContext.doc_id_graphql_query


def _patched_doc_id_graphql_query(self, doc_id, variables, referer=None, web_api=True):
    return _orig_doc_id_graphql_query(self, doc_id, variables, referer=referer, web_api=web_api)


il.InstaloaderContext.doc_id_graphql_query = _patched_doc_id_graphql_query


def make_loader(controls, **kwargs):
    loader = il.Instaloader(quiet=True, rate_controller=controls.state.upstream_controller,
                           request_timeout=30, max_connection_attempts=2, sanitize_paths=True, **kwargs)
    attach_context_handlers(loader, controls)
    return loader


def attach_context_handlers(loader, controls):
    loader.context.log = lambda *args, **kwargs: None

    def report(message, repeat_at_end=True):
        controls.classify_message(message)
        if not repeat_at_end:
            controls.emit("log", {"level": "warn", "message": "An Instagram request failed. Retrying once."})

    loader.context.error = report


class DownloadLoader(il.Instaloader):
    def __init__(self, job, operation):
        self.job = job
        self.operation = operation
        self.controls = operation.controls
        o = job.options
        super().__init__(
            quiet=True, rate_controller=self.controls.state.upstream_controller, request_timeout=30,
            max_connection_attempts=2, sanitize_paths=True, dirname_pattern="{target}",
            filename_pattern=o.file_pattern, download_pictures=o.photos, download_videos=o.videos,
            download_video_thumbnails=o.thumbnails, download_geotags=o.geotags, download_comments=o.comments,
            save_metadata=o.metadata, compress_json=o.compress_metadata,
            post_metadata_txt_pattern=(o.post_text_pattern or "{caption}") if o.captions else "",
            storyitem_metadata_txt_pattern=(o.story_text_pattern or "{caption}") if o.captions else "",
            resume_prefix=".archivist-resume" if o.resume else None, slide=o.carousel,
        )
        attach_context_handlers(self, self.controls)
        self.context.write_raw = self.write_media
        # Only fresh media from Instagram's media hosts can be fetched by an imported checkpoint.
        fetch_raw = self.context.get_raw

        def get_raw(url):
            if not safe_media_url(url):
                raise ValidationError("Instagram returned an unsupported media address.")
            return fetch_raw(url)

        self.context.get_raw = get_raw

    def checked_path(self, filename):
        self.controls.check_canceled()
        path = Path(filename)
        if not path.resolve().is_relative_to(self.job.destination):
            raise ValidationError("An output path resolved outside the selected folder.")
        return path

    @contextmanager
    def output(self, directory):
        directory = self.checked_path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        previous = self.dirname_pattern
        self.dirname_pattern = str(directory).replace("{", "{{").replace("}", "}}")
        try:
            yield
        finally:
            self.dirname_pattern = previous

    def write_media(self, source, filename):
        dest = self.checked_path(filename)
        temp = None
        try:
            with NamedTemporaryFile(dir=dest.parent, prefix=".archivist-", suffix=".partial", delete=False) as output:
                temp = Path(output.name)
                if isinstance(source, Response):
                    for chunk in source.iter_content(256 * 1024):
                        self.controls.check_canceled()
                        if chunk:
                            output.write(chunk)
                else:
                    output.write(source)
            self.controls.check_canceled()
            temp.replace(dest)
            self.operation.files += 1
            self.operation.media_files += 1
        finally:
            if isinstance(source, Response):
                source.close()
            if temp is not None:
                temp.unlink(missing_ok=True)

    def save_metadata_json(self, filename, structure):
        extension = ".json.xz" if self.compress_json else ".json"
        dest = self.checked_path(str(filename) + extension)
        with NamedTemporaryFile(dir=dest.parent, prefix=".archivist-", suffix=extension, delete=False) as tmp:
            temp = Path(tmp.name)
        try:
            il.save_structure_to_file(structure, str(temp))
            self.controls.check_canceled()
            temp.replace(dest)
            self.operation.files += 1
        finally:
            temp.unlink(missing_ok=True)

    @contextmanager
    def track_sidecar(self, filename):
        path = self.checked_path(filename)
        before = path.stat().st_mtime_ns if path.is_file() else None
        yield
        if path.is_file() and path.stat().st_mtime_ns != before:
            self.operation.files += 1

    def save_caption(self, filename, mtime, caption):
        with self.track_sidecar(filename + ".txt"):
            super().save_caption(filename, mtime, caption)

    def save_location(self, filename, location, mtime):
        with self.track_sidecar(filename + "_location.txt"):
            super().save_location(filename, location, mtime)

    def update_comments(self, filename, post):
        with self.track_sidecar(filename + "_comments.json"):
            super().update_comments(filename, post)

    def download_storyitem(self, item, target):
        """Use the same media toggles for story items as for regular posts."""
        filename = str(Path(self.dirname_pattern.format()) / self.format_filename(item, target=target))
        prepare = self._Instaloader__prepare_filename
        media_before = self.operation.media_files
        if item.is_video and self.download_videos:
            video_url = item.video_url
            if video_url:
                self.download_pic(prepare(filename, lambda: video_url), video_url, item.date_local)
        if self.download_pictures and (not item.is_video or self.download_video_thumbnails):
            self.download_pic(prepare(filename, lambda: item.url), item.url, item.date_local)
        sidecar = prepare(filename, lambda: item.url)
        text = _ArbitraryItemFormatter(item).format(self.storyitem_metadata_txt_pattern, target=target).strip()
        if text:
            self.save_caption(sidecar, item.date_local, text)
        if self.save_metadata:
            self.save_metadata_json(sidecar, item)
        return self.operation.media_files > media_before


class DownloadOperation:
    def __init__(self, job: Job, controls):
        self.job = job
        self.controls = controls
        self.options = job.options
        self.files = self.items = self.media_files = self.failures = 0
        self.consecutive_network_failures = 0
        self.last_problem = ""
        self.phase = "Preparing download"
        self.loader = None

    def progress(self, phase=None):
        if phase is not None:
            self.phase = phase
        self.controls.emit("progress", {"phase": self.phase, "items": self.items, "files": self.files})

    def message(self, message, level="info"):
        self.controls.emit("log", {"message": message, "level": level})

    @contextmanager
    def recovery(self):
        try:
            yield
        except (InstaloaderException, ValidationError, KeyError, TypeError, ValueError, RequestException) as error:
            self.controls.classify_message(error)
            self.failures += 1
            self.last_problem = friendly_error(error)
            self.message(self.last_problem, "warn")
            if isinstance(error, (ConnectionException, RequestException)):
                self.consecutive_network_failures += 1
                if self.consecutive_network_failures >= 3:
                    self.message("Multiple consecutive network requests failed. Entering safety cooldown to protect your account.", "warn")
                    self.consecutive_network_failures = 0
                    self.controls.impose_cooldown()
                else:
                    self.controls.wait(1.5)

    def folders(self, target, profile=None):
        folder = self.options.folder_pattern.format(target=target, profile=profile or target)
        try:
            parts = [path_segment(part) for part in folder.split("/")]
        except ValidationError:
            if self.options.folder_pattern == "{target}" and re.fullmatch(r"[A-Za-z0-9._]+", target):
                parts = [target.rstrip(" .") + "_"]
            else:
                raise
        return self.job.destination.joinpath(*parts)

    def filter_match(self, item):
        options = self.options
        if options.since or options.until:
            date = item.date_utc.date()
            if options.since and date < options.since or options.until and date > options.until:
                return False
        if options.caption_contains and options.caption_contains not in (item.caption or "").casefold():
            return False
        return True

    def save_post(self, post, target):
        loader = self.loader
        media_before = self.media_files
        start, end = loader.slide_start, loader.slide_end
        if loader.slide and post.typename == "GraphSidecar":
            size = post.mediacount
            if start >= size:
                self.message("Skipped a carousel with fewer slides than the requested range.", "warn")
                return None
            if end >= size:
                loader.slide_end = size - 1
        try:
            # A moved shortcode can cause Instaloader to request a second metadata lookup.
            try:
                updated = loader.download_post(post, target)
            except PostChangedException:
                updated = loader.download_post(post, target)
            except (ConnectionException, RequestException) as err:
                self.controls.classify_message(err)
                self.message("Instagram connection hiccup. Retrying in 2 seconds...", "warn")
                self.controls.wait(2.0)
                try:
                    updated = loader.download_post(post, target)
                except (ConnectionException, RequestException) as err2:
                    self.controls.classify_message(err2)
                    self.message("Retry failed. Final retry in 4 seconds...", "warn")
                    self.controls.wait(4.0)
                    updated = loader.download_post(post, target)
            self.consecutive_network_failures = 0
            return updated or self.media_files > media_before
        finally:
            loader.slide_end = end

    def post_stream(self, iterator, target, directory, phase, *, pinned=0):
        self.progress(phase)
        options = self.options
        loader = self.loader
        matched = 0
        prior_matches = 0
        last_match_index = 0
        config_key = sha256(json.dumps([phase, asdict(options)], default=str, sort_keys=True).encode()).hexdigest()[:12]

        def load_resume(context, name):
            nonlocal prior_matches
            path = loader.checked_path(name)
            try:
                with lzma.open(path, "rt", encoding="utf-8") as reader:
                    data = json.load(reader)
                count = data.get("archivist_matches", 0)
                prior_matches = count if type(count) is int and count >= 0 else 0
                return il.load_structure(context, data)
            except (AttributeError, TypeError, ValueError) as error:
                raise il.InvalidArgumentException("Invalid resume information.") from error

        def save_resume(state, name):
            # Save even when the cancellation flag is already set.
            path = Path(name)
            if not path.resolve().is_relative_to(self.job.destination):
                return
            with NamedTemporaryFile(dir=path.parent, suffix=".xz", delete=False) as tmp:
                temp = Path(tmp.name)
            try:
                # NodeIterator rewinds one item so partial downloads can be checked again.
                # Give that item back its limit slot when it had already been counted.
                archived_matches = matched - int(last_match_index > state.total_index)
                with lzma.open(temp, "wt", encoding="utf-8") as writer:
                    json.dump({"node": state._asdict(), "instaloader": {
                        "node_type": "FrozenNodeIterator", "version": il.__version__},
                        "archivist_matches": archived_matches}, writer)
                temp.replace(path)
                self.message("Saved a resume point for this stream.")
            finally:
                temp.unlink(missing_ok=True)

        with loader.output(directory), il.resumable_iteration(
                context=loader.context, iterator=iterator, load=load_resume, save=save_resume,
                format_path=lambda magic: str(directory / f".archivist-resume-{config_key}-{magic}.json.xz"),
                check_bbd=True, enabled=options.resume) as (resumed, start):
            if resumed:
                matched = prior_matches
                self.message("Resuming this stream from its last saved position.")
            number = start
            while options.max_items is None or matched < options.max_items:
                self.controls.check_canceled()
                try:
                    post = next(iterator)
                except StopIteration:
                    break
                number += 1
                if not self.filter_match(post):
                    continue
                with self.recovery():
                    updated = self.save_post(post, target)
                    if updated is None:
                        continue
                    matched += 1
                    last_match_index = number
                    self.items += 1
                    self.progress()
                    if options.fast_update and updated is False and number > max(pinned, start + int(resumed)):
                        self.message("Fast update stopped at existing media.")
                        break

    def stories(self, iterator, target, directory, phase):
        self.progress(phase)
        matched = 0
        with self.loader.output(directory):
            for item in iterator:
                self.controls.check_canceled()
                if self.options.max_items is not None and matched >= self.options.max_items:
                    break
                if not self.filter_match(item):
                    continue
                if not self.options.metadata and not self.options.captions and (
                        item.is_video and not (self.options.videos or self.options.thumbnails)
                        or not item.is_video and not self.options.photos):
                    continue
                with self.recovery():
                    updated = self.loader.download_storyitem(item, target)
                    matched += 1
                    self.items += 1
                    self.progress()
                    if self.options.fast_update and not updated:
                        self.message("Fast update stopped at existing story media.")
                        break

    def check_profile_access(self, profile):
        if not profile.is_private:
            return
        context = self.loader.context
        if not context.is_logged_in:
            raise LoginRequiredException()
        if context.username.casefold() != profile.username.casefold() and not profile.followed_by_viewer:
            raise PrivateProfileNotFollowedException("This private profile must approve your follow request first.")

    def lookup_post(self, code):
        """Read media from the regular public post page for anonymous requests."""
        context = self.loader.context
        code = shortcode(code)
        if context.is_logged_in:
            return il.Post.from_shortcode(context, code)

        page = context.get_page_data(f"p/{code}/")
        for block in page:
            media = block.get("xig_polaris_media")
            if not isinstance(media, dict) or media.get("code") != code:
                continue
            visible = media.get("if_not_gated_logged_out")
            if "gating_ruling" not in media or media["gating_ruling"] is not None or not isinstance(visible, dict):
                raise LoginRequiredException("Instagram did not make this post available to signed-out viewers.")
            owner = visible.get("user")
            if not isinstance(owner, dict) or owner.get("is_private") is not False or owner.get("is_unpublished"):
                raise LoginRequiredException("Instagram did not make this account available to signed-out viewers.")
            if visible.get("code") == code:
                return il.Post(context, il.Post._normalize_post_data(visible))
        raise BadResponseException("The public post page did not contain downloadable media.")

    def profile_post_iterator(self, profile, *, reels=False):
        iterator = profile.get_reels() if reels else profile.get_posts()
        if not self.loader.context.is_logged_in:
            # Use the upstream paginated timeline but hydrate its sparse rows from the public post page.
            select = (lambda node: node["media"]["code"]) if reels else (lambda node: node["code"])
            iterator._node_wrapper = lambda node: self.lookup_post(select(node))
        return iterator

    def profile(self, profile):
        self.check_profile_access(profile)
        target = username(profile.username)
        folder = self.folders(target)
        self.message(f"Archiving @{target}.")
        options = self.options
        if options.profile_picture or options.metadata:
            self.progress("Profile details")
            with self.loader.output(folder):
                if options.profile_picture:
                    with self.recovery():
                        before = self.files
                        self.loader.download_profilepic(profile)
                        self.items += int(self.files > before)
                if options.metadata:
                    with self.recovery():
                        self.loader.save_metadata_json(str(folder / f"{target}_{int(profile.userid)}"), profile)
            self.progress()

        streams = (
            (options.posts, lambda: self.profile_post_iterator(profile), folder, "Profile posts", 3),
            (options.reels, lambda: self.profile_post_iterator(profile, reels=True), folder, "Reels", 3),
            (options.tagged, profile.get_tagged_posts, folder / "Tagged", "Tagged posts", 0),
            (options.igtv, profile.get_igtv_posts, folder, "IGTV", 0),
        )
        for enabled, get_items, output, phase, pinned in streams:
            if enabled:
                self.controls.check_canceled()
                self.progress(phase)
                with self.recovery():
                    self.post_stream(get_items(), target, output, phase, pinned=pinned)
        if options.stories:
            self.progress("Stories")
            with self.recovery():
                self.archive_stories(self.loader.get_stories([profile.userid]))
        if options.highlights:
            self.progress("Highlights")
            with self.recovery():
                for highlight in self.loader.get_highlights(profile):
                    label = re.sub(r"[^\w -]+", " ", highlight.title).strip()[:64].strip() or "Highlight"
                    output = folder / "Highlights" / f"{int(highlight.unique_id)} {label}"
                    with self.loader.output(output), self.recovery():
                        self.loader.download_highlight_cover(highlight, target)
                    with self.recovery():
                        self.stories(highlight.get_items(), target, output, "Highlights")

    def archive_stories(self, iterator):
        for story in iterator:
            target = username(story.owner_username)
            with self.recovery():
                self.stories(story.get_items(), target, self.folders(target) / "Stories", "Stories")

    def run_target(self, kind, target):
        context = self.loader.context
        if kind == "profile":
            self.profile(il.Profile.from_username(context, target))
        elif kind == "followees":
            self.progress("Followed profiles")
            root = il.Profile.from_username(context, target)
            self.check_profile_access(root)
            for profile in root.get_followees():
                self.controls.check_canceled()
                with self.recovery():
                    self.profile(profile)
        elif kind == "post":
            self.progress("Single post")
            post = self.lookup_post(target)
            self.post_stream(iter([post]), target, self.folders("Posts", username(post.owner_username)), "Single post")
        elif kind == "metadata":
            reference, media = metadata_reference(target)
            if reference == "Post":
                self.run_target("post", media)
            else:
                if not context.is_logged_in:
                    raise LoginRequiredException()
                story = il.StoryItem.from_mediaid(context, media)
                self.stories(iter([story]), story.shortcode, self.folders("Stories", username(story.owner_username)),
                             "Archived story")
        elif kind == "hashtag":
            self.progress("Hashtag posts")
            name = f"Tag-{target}"
            folder = self.folders(name)
            hashtag = il.Hashtag.from_name(context, target)
            if self.options.profile_picture:
                with self.loader.output(folder), self.recovery():
                    self.loader.download_hashtag_profilepic(hashtag)
            if self.options.posts:
                self.post_stream(hashtag.get_posts_resumable(), name, folder, "Hashtag posts")
        else:
            self.progress("Location posts")
            name = f"Location-{target}"
            self.post_stream(self.loader.get_location_posts(target), name, self.folders(name), "Location posts")

    def run(self, session, account):
        self.progress()
        job = self.job
        job.destination.mkdir(parents=True, exist_ok=True)
        self.loader = DownloadLoader(job, self)
        with self.loader:
            if job.use_session:
                if not isinstance(session, dict) or not (session.get("sessionid") and session.get("csrftoken")) or not all(
                        isinstance(key, str) and isinstance(value, str) for key, value in session.items()):
                    raise ValidationError("Sign in to use your Instagram account for this download.")
                self.loader.load_session(username(account), session)
                self.controls.signed_in = True
            if job.target_type in {"feed", "saved", "stories"}:
                self.run_account_target(job.target_type)
            else:
                for target in job.targets:
                    self.controls.check_canceled()
                    with self.recovery():
                        self.run_target(job.target_type, target)
        self.progress()
        if self.failures:
            return ("partial", "Some requested content could not be downloaded.") if self.items or self.files else (
                "failed", self.last_problem)
        if not (self.items or self.files):
            return "completed", "No media matched the selection or all selected files are already present."
        return "completed", "Download completed."

    def run_account_target(self, kind):
        with self.recovery():
            if kind == "stories":
                self.progress("Followed stories")
                self.archive_stories(self.loader.get_stories())
            elif kind == "feed":
                self.post_stream(self.loader.get_feed_posts(), "Feed", self.folders("Feed"), "Home feed")
            else:
                context = self.loader.context
                saved = il.Profile.from_username(context, context.username).get_saved_posts()
                self.post_stream(saved, "Saved", self.folders("Saved"), "Saved posts")
