from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import unittest

import instaloader as il
from instaloader.exceptions import LoginRequiredException
from requests import Response

from engine.download import DownloadLoader, DownloadOperation
from engine.options import Job
from engine.transport import Canceled, Controls, RateState


class DownloadTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.destination = Path(temporary.name)

    def make_operation(self, options):
        request = dict(targetType="profile", targets=["portfolio"], destination=str(self.destination),
                       useSession=False, options={"metadata": False, "captions": False, **options})
        state = RateState()
        controls = Controls(state, Event(), lambda *args: None)
        state.controls = controls
        operation = DownloadOperation(Job.parse(request), controls)
        operation.loader = DownloadLoader(operation.job, operation)
        self.addCleanup(operation.loader.close)
        operation.loader.context.get_raw = self.media_response
        return operation

    @staticmethod
    def media_response(url):
        response = Response()
        response.status_code = 200
        response.url = url
        response.headers["Content-Type"] = "image/jpeg"
        response.raw = BytesIO(b"mock image body")
        return response

    @staticmethod
    def post(operation, name, *, caption="Test caption", day=1, carousel=False):
        node = dict(shortcode=name, display_url=f"https://image.cdninstagram.com/{name}.jpg", is_video=False,
                    taken_at_timestamp=int(datetime(2024, 4, day, 10, 30, tzinfo=timezone.utc).timestamp()),
                    caption=caption, __typename="GraphSidecar" if carousel else "GraphImage")
        if carousel:
            node["edge_sidecar_to_children"] = {"edges": [{"node": {"is_video": False, "display_url":
                f"https://image.cdninstagram.com/{name}_{i}.jpg"}} for i in (1, 2)]}
        return il.Post(operation.loader.context, node)

    def test_fast_update_keeps_scanning_after_filling_a_partial_carousel(self):
        operation = self.make_operation({"fastUpdate": True})
        folder = self.destination / "portfolio"
        folder.mkdir()
        first_slide = folder / "2024-04-01_10-30-00_UTC_Carousel_1.jpg"
        first_slide.write_bytes(b"existing image")
        posts = (self.post(operation, "Carousel", carousel=True), self.post(operation, "Next"))
        operation.post_stream(iter(posts), "portfolio", folder, "Profile posts")
        self.assertEqual(first_slide.read_bytes(), b"existing image")
        self.assertTrue((folder / "2024-04-01_10-30-00_UTC_Carousel_2.jpg").is_file())
        self.assertTrue((folder / "2024-04-01_10-30-00_UTC_Next.jpg").is_file())
        self.assertEqual(operation.files, 2)

    def test_item_cap_counts_caption_and_date_matches(self):
        operation = self.make_operation({"captionContains": "portfolio", "since": "2024-04-02", "maxItems": 1})
        folder = self.destination / "portfolio"
        posts = (self.post(operation, "TooOld", caption="portfolio", day=1),
                 self.post(operation, "OtherCaption", day=2),
                 self.post(operation, "Target", caption="An edited PORTFOLIO", day=2),
                 self.post(operation, "BeyondLimit", caption="portfolio", day=3))
        operation.post_stream(iter(posts), "portfolio", folder, "Profile posts")
        self.assertEqual([file.name for file in folder.iterdir()], ["2024-04-02_10-30-00_UTC_Target.jpg"])
        self.assertEqual(operation.items, 1)

    def test_resume_rechecks_the_last_item_without_spending_a_second_slot(self):
        folder = self.destination / "portfolio"
        first = self.make_operation({"maxItems": 2})

        def cancel_after_first(event, payload):
            if event == "progress" and payload["items"] == 1:
                first.controls.cancel.set()

        def stream(operation):
            posts = [self.post(operation, name) for name in ("First", "Second", "Third")]
            return il.NodeIterator(operation.loader.context, "fixture", lambda data: data,
                                   lambda node: il.Post(operation.loader.context, node),
                                   first_data={"edges": [{"node": post._node} for post in posts]})

        first.controls.emit = cancel_after_first
        with self.assertRaises(Canceled):
            first.post_stream(stream(first), "portfolio", folder, "Profile posts")
        self.assertEqual(len(list(folder.glob("*.json.xz"))), 1)

        second = self.make_operation({"maxItems": 2})
        second.post_stream(stream(second), "portfolio", folder, "Profile posts")
        self.assertEqual(sorted(file.name for file in folder.iterdir()), [
            "2024-04-01_10-30-00_UTC_First.jpg", "2024-04-01_10-30-00_UTC_Second.jpg",
        ])

    def test_signed_out_post_uses_only_the_explicitly_ungated_public_html(self):
        operation = self.make_operation({})
        public_media = {"code": "Public", "pk": "1000", "media_type": 1, "taken_at": 1711967400,
                        "user": {"pk": "100", "username": "portfolio", "is_private": False},
                        "image_versions2": {"candidates": [{"url": "https://image.cdninstagram.com/Public.jpg"}]}}
        post = {"code": "Public", "gating_ruling": None, "if_not_gated_logged_out": public_media}
        operation.loader.context.get_page_data = lambda path: [{"xig_polaris_media": post}]
        operation.loader.context.doc_id_graphql_query = lambda *args, **kwargs: self.fail("Unexpected authenticated lookup")
        operation.run_target("post", "Public")
        self.assertEqual(operation.files, 1)
        self.assertTrue(next(self.destination.rglob("*.jpg")).name.endswith("_Public.jpg"))

        post["gating_ruling"] = {"kind": "login"}
        with self.assertRaises(LoginRequiredException):
            operation.lookup_post("Public")
        post["gating_ruling"] = None
        public_media["user"]["is_private"] = True
        with self.assertRaises(LoginRequiredException):
            operation.lookup_post("Public")
