from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math
from time import monotonic
from urllib.parse import urljoin, urlsplit

from instaloader import RateController, instaloadercontext
from instaloader.exceptions import AbortDownloadException
import requests

from engine.options import INSTAGRAM_HOSTS, safe_media_url


class Canceled(AbortDownloadException):
    pass


class CooldownStop(AbortDownloadException):
    pass


class SessionExpired(AbortDownloadException):
    pass


class Checkpoint(AbortDownloadException):
    def __init__(self, url=None):
        super().__init__("Complete Instagram’s security check in your browser, then try again.")
        self.url = url


class RateState:
    def __init__(self):
        self.until = 0.0
        self.controls = None
        self.controller = None

    def upstream_controller(self, context):
        if self.controller is None:
            self.controller = SharedRateController(context, self)
        else:
            # The controller caches request history. Only its current logging context changes.
            self.controller._context = context
        return self.controller


class SharedRateController(RateController):
    def __init__(self, context, state):
        super().__init__(context)
        self.state = state

    def sleep(self, seconds):
        self.state.controls.wait(seconds)


def instagram_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        return url.scheme == "https" and url.netloc.lower() in INSTAGRAM_HOSTS | {"i.instagram.com"}
    except (TypeError, ValueError):
        return False


def checkpoint_url(value):
    if isinstance(value, str):
        url = urljoin("https://www.instagram.com/", value)
        if instagram_url(url):
            return url
    return "https://www.instagram.com/"


def retry_after(value):
    if not value:
        return 0
    try:
        if value.isdecimal():
            return int(value)
        date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        return max(0, math.ceil((date - datetime.now(timezone.utc)).total_seconds()))
    except (OverflowError, TypeError, ValueError):
        return 0


class Controls:
    def __init__(self, state, cancel, emit):
        self.state = state
        self.cancel = cancel
        self.emit = emit
        self.signed_in = False

    def check_canceled(self):
        if self.cancel.is_set():
            raise Canceled("Canceled. Saved files are still available.")

    def before_request(self):
        self.check_canceled()
        remaining = self.state.until - monotonic()
        if remaining > 0:
            self.report_cooldown(math.ceil(remaining))

    def wait(self, seconds):
        if seconds > 1:
            self.emit("cooldown", {"seconds": math.ceil(seconds), "message": "Waiting for Instagram’s request window."})
        if self.cancel.wait(seconds):
            self.check_canceled()

    def impose_cooldown(self, seconds):
        self.state.until = max(self.state.until, monotonic() + seconds)
        self.report_cooldown(math.ceil(self.state.until - monotonic()))

    def report_cooldown(self, seconds):
        message = "Instagram asked for a pause. Downloads can resume after the cooldown."
        self.emit("cooldown", {"seconds": seconds, "message": message})
        self.check_canceled()
        raise CooldownStop(message)

    def classify_message(self, value):
        message = str(value).casefold()
        if "429 too many requests" in message or "429 - too many requests" in message:
            self.impose_cooldown(900)
        if any(term in message for term in ("please wait a few minutes", "feedback_required", "rate limited")):
            self.impose_cooldown(900)
        if "login_required" in message or "you've been logged out" in message:
            if self.signed_in:
                raise SessionExpired("Your Instagram session expired. Sign in again to continue.")
        if "checkpoint_required" in message or "challenge_required" in message:
            raise Checkpoint(checkpoint_url(None))

    def check_response(self, response, **_):
        status = response.status_code
        if status == 429:
            # Honor the server's Retry-After, with a conservative fallback when it is absent.
            wait = retry_after(response.headers.get("Retry-After")) or 900
            response.close()
            self.impose_cooldown(wait)
        if not instagram_url(response.url):
            return
        redirect = response.headers.get("Location", "")
        if self.signed_in and response.is_redirect and urlsplit(redirect).path.startswith("/accounts/login"):
            response.close()
            raise SessionExpired("Your Instagram session expired. Sign in again to continue.")
        if response.is_redirect and urlsplit(redirect).path.startswith(("/challenge/", "/checkpoint/")):
            response.close()
            raise Checkpoint(checkpoint_url(redirect))
        if "json" not in response.headers.get("Content-Type", "").lower():
            return
        try:
            body = response.json()
        except ValueError:
            return
        if isinstance(body, dict):
            if body.get("checkpoint_url") or body.get("message") in ("checkpoint_required", "challenge_required"):
                raise Checkpoint(checkpoint_url(body.get("checkpoint_url")))
            self.classify_message(body.get("message", ""))
            errors = body.get("errors")
            if isinstance(errors, list):
                for error in errors:
                    if isinstance(error, dict):
                        self.classify_message(error.get("message", ""))


class GuardedSession(requests.Session):
    def __init__(self, state):
        super().__init__()
        self.state = state
        self.hooks["response"].append(self.check_response)

    def check_response(self, response, **kwargs):
        self.state.controls.check_response(response, **kwargs)

    def send(self, request, **kwargs):
        self.state.controls.before_request()
        if not (instagram_url(request.url) or safe_media_url(request.url)):
            raise AbortDownloadException("Instagram returned a media URL outside its supported hosts.")
        return super().send(request, **kwargs)


class ControlledRequests:
    """Give Instaloader guarded HTTP sessions without changing Requests process-wide."""

    def __init__(self, state):
        self.state = state

    def Session(self):
        return GuardedSession(self.state)

    def __getattr__(self, name):
        return getattr(requests, name)


@contextmanager
def install_transport(state):
    original = instaloadercontext.requests
    instaloadercontext.requests = ControlledRequests(state)
    try:
        yield
    finally:
        instaloadercontext.requests = original
