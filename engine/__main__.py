from contextlib import suppress
import json
import re
import sys
from threading import Event, Lock, Thread
from time import monotonic

from instaloader.exceptions import (
    AbortDownloadException, BadCredentialsException, LoginException, TwoFactorAuthRequiredException,
)

from engine.download import DownloadOperation, friendly_error, make_loader
from engine.options import Job, ValidationError, username
from engine.transport import (
    Canceled, Checkpoint, Controls, CooldownStop, RateState, SessionExpired, checkpoint_url, install_transport,
)


class Worker:
    def __init__(self, output):
        self.output = output
        self.rate = RateState()
        self.output_lock = Lock()
        self.active_lock = Lock()
        self.active = None
        self.pending = None

    def emit(self, id, event, payload):
        record = {"id": id, "event": event, **payload}
        with self.output_lock, suppress(BrokenPipeError, OSError):
            self.output.write(json.dumps(record, ensure_ascii=True) + "\n")
            self.output.flush()

    def dispatch(self, message):
        id = message.get("id")
        command = message.get("command")
        if not isinstance(id, str):
            return
        with self.active_lock:
            if command == "cancel":
                if self.active and self.active[0] == message.get("targetId"):
                    self.active[1].set()
                return
            if self.active:
                self.emit(id, "result", {"status": "failed", "message": "Another operation is already running."})
                return
            cancel = Event()
            thread = Thread(target=self.run_command, args=(message, cancel), daemon=True)
            self.active = (id, cancel, thread)
            thread.start()

    def close_pending(self):
        if self.pending:
            loader, _ = self.pending
            pending = loader.context.two_factor_auth_pending
            if pending:
                pending[0].close()
                loader.context.two_factor_auth_pending = None
            loader.close()
            self.pending = None

    def run_command(self, message, cancel):
        id = message["id"]
        command = message.get("command")
        controls = Controls(self.rate, cancel, lambda event, payload: self.emit(id, event, payload))
        self.rate.controls = controls
        operation = None
        result = {"status": "failed", "message": "The download worker stopped unexpectedly."}
        try:
            if self.pending and monotonic() >= self.pending[1]:
                self.close_pending()
            if command == "logout":
                self.close_pending()
                result = {"status": "completed", "message": "Signed out."}
            elif command == "login":
                controls.before_request()
                result = self.login(message, controls)
            elif command == "two-factor":
                controls.before_request()
                result = self.two_factor(message, controls)
            elif command == "download":
                job = Job.parse(message.get("request"))
                controls.before_request()
                operation = DownloadOperation(job, controls)
                status, detail = operation.run(message.get("session"), message.get("username"))
                result = {"status": status, "message": detail}
            else:
                raise ValidationError("The download worker received an unknown command.")
        except Canceled as error:
            if command in {"login", "two-factor"}:
                self.close_pending()
            result = {"status": "canceled", "message": str(error)}
        except SessionExpired as error:
            result = {"status": "failed", "code": "session-expired", "message": str(error)}
        except Checkpoint as error:
            result = {"status": "checkpoint" if command in {"login", "two-factor"} else "failed", "message": str(error),
                      "url": error.url}
            if command == "download":
                result["code"] = "checkpoint-required"
        except CooldownStop as error:
            result = {"status": "failed", "code": "rate-limited", "message": str(error)}
        except AbortDownloadException as error:
            result = {"status": "failed", "message": self.safe_abort_message(error)}
        except LoginException as error:
            result = self.login_error(error, controls)
        except Exception as error:
            result = {"status": "failed", "message": friendly_error(error)}
        finally:
            if operation is not None:
                result.update(items=operation.items, files=operation.files)
            self.rate.controls = None
            with self.active_lock:
                self.active = None
                self.emit(id, "result", result)

    def login(self, message, controls):
        self.close_pending()
        user = username(str(message.get("username", "")).strip().removeprefix("@"))
        password = message.get("password")
        if not isinstance(password, str) or not password:
            raise ValidationError("Enter your Instagram password.")
        loader = make_loader(controls)
        try:
            loader.login(user, password)
            controls.check_canceled()
            return self.session_result(loader)
        except TwoFactorAuthRequiredException:
            controls.check_canceled()
            self.pending = (loader, monotonic() + 600)
            return {"status": "two-factor", "message": "Enter the verification code from Instagram."}
        finally:
            if not self.pending:
                loader.close()

    def two_factor(self, message, controls):
        if not self.pending:
            raise ValidationError("The sign-in request expired. Enter your username and password again.")
        code = message.get("code")
        if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6,8}", code.strip()):
            return {"status": "two-factor", "message": "Enter the 6- or 8-digit Instagram verification code."}
        loader, _ = self.pending
        try:
            loader.two_factor_login(code.strip())
            controls.check_canceled()
            result = self.session_result(loader)
        except BadCredentialsException as error:
            # Instagram may use this exception both for a wrong code and for throttling.
            controls.classify_message(error)
            return {"status": "two-factor", "message": "Instagram rejected the code. Check it and try again."}
        except Exception:
            self.close_pending()
            raise
        self.close_pending()
        return result

    @staticmethod
    def session_result(loader):
        session = loader.save_session()
        if not session.get("sessionid") or not session.get("csrftoken"):
            raise LoginException("Session creation failed.")
        return {"status": "authenticated", "message": "Signed in to Instagram.",
                "username": loader.context.username, "session": session}

    @staticmethod
    def safe_abort_message(error):
        if str(error) == "Instagram returned a media URL outside its supported hosts.":
            return str(error)
        return "Instagram stopped the request. Open Instagram to check your account before retrying."

    @staticmethod
    def login_error(error, controls):
        try:
            controls.classify_message(error)
        except CooldownStop as throttled:
            return {"status": "failed", "code": "rate-limited", "message": str(throttled)}
        except Checkpoint as checkpoint:
            return {"status": "checkpoint", "message": str(checkpoint), "url": checkpoint.url}
        detail = str(error)
        match = re.search(r"Checkpoint required\. Point your browser to ([^\s]+)", detail)
        if match:
            return {"status": "checkpoint", "message": str(Checkpoint()), "url": checkpoint_url(match.group(1))}
        if isinstance(error, BadCredentialsException):
            return {"status": "failed", "message": friendly_error(error)}
        return {"status": "failed", "message": "Instagram could not sign in. Verify your account in the browser and try again."}

    def run(self, source):
        with install_transport(self.rate):
            for line in source:
                try:
                    message = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(message, dict):
                    self.dispatch(message)
            with self.active_lock:
                active = self.active
                if active:
                    active[1].set()
            if active:
                active[2].join(timeout=35)
            if not active or not active[2].is_alive():
                self.close_pending()


def main():
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8")
    Worker(sys.stdout).run(sys.stdin)


if __name__ == "__main__":
    main()
