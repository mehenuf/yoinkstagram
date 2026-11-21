import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from engine.options import Job, ValidationError, metadata_reference, safe_media_url


class OptionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.request = dict(targetType="profile", targets=["@Design.Archive", "https://instagram.com/design.archive/"],
                            destination=self.temp.name, useSession=False, options={})

    def test_normalizes_and_deduplicates_targets_without_an_implicit_limit(self):
        job = Job.parse(self.request)
        self.assertEqual(job.targets, ("design.archive",))
        self.assertIsNone(job.options.max_items)

    def test_rejects_traversal_and_formatter_introspection(self):
        for pattern in ("../{target}", "C:/temp", "{target!r}", "{profile.__class__}", "{target}/{target}/.."):
            with self.subTest(pattern=pattern), self.assertRaises(ValidationError):
                Job.parse({**self.request, "options": {"folderPattern": pattern}})

    def test_accepts_date_tokens_and_rejects_reversed_date_ranges(self):
        options = {"filePattern": "{date_utc:%Y-%m-%d}_{shortcode}", "since": "2024-01-01", "until": "2024-12-31"}
        Job.parse({**self.request, "options": options})
        with self.assertRaises(ValidationError):
            Job.parse({**self.request, "options": {**options, "until": "2023-12-31"}})

    def test_rejects_non_instagram_profile_urls(self):
        with self.assertRaises(ValidationError):
            Job.parse({**self.request, "targets": ["https://instagram.com.attacker.invalid/elsie/"]})

    def test_single_media_url_produces_a_shortcode(self):
        job = Job.parse({**self.request, "targetType": "post", "targets": ["https://www.instagram.com/reel/Xy_z-/?igsh=123"]})
        self.assertEqual(job.targets, ("Xy_z-",))

    def test_metadata_uses_identifier_and_ignores_embedded_media_url(self):
        metadata = Path(self.temp.name, "archive.json")
        metadata.write_text(json.dumps({"instaloader": {"node_type": "Post"}, "node": {
            "shortcode": "Xy_z-", "display_url": "http://127.0.0.1/internal"
        }}), encoding="utf-8")
        self.assertEqual(metadata_reference(str(metadata)), ("Post", "Xy_z-"))

    def test_media_urls_must_be_https_and_on_an_instagram_cdn(self):
        self.assertTrue(safe_media_url("https://scontent.example.cdninstagram.com/image.jpg?token=123"))
        for url in ("http://images.cdninstagram.com/a", "https://cdninstagram.com.attacker.invalid/a",
                    "https://scontent.cdninstagram.com@localhost/a", "https://localhost/a"):
            with self.subTest(url=url):
                self.assertFalse(safe_media_url(url))
