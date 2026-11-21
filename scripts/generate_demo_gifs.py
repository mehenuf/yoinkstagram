"""
Generates high-definition operational showcase GIFs for the Yoinkstagram README.
Simulates real UI states:
1. demo-queue.gif: Target selection, chip toggles, and queuing
2. demo-theme.gif: Dynamic Light/Dark mode appearance toggling
3. demo-download.gif: Live queue execution, progress streaming, and completion
"""

import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ASSETS_DIR = Path("docs/assets")
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Fonts
FONT_MAIN = "C:/Windows/Fonts/segoeui.ttf"
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_SEMI = "C:/Windows/Fonts/segoeuisl.ttf"

def get_font(size, bold=False):
    try:
        font_path = FONT_BOLD if bold else FONT_MAIN
        return ImageFont.truetype(font_path, size)
    except Exception:
        return ImageFont.load_default()

# -------------------------------------------------------------------------
# Helper functions for drawing modern UI elements
# -------------------------------------------------------------------------
def draw_rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

def draw_window_frame(draw, width, height, is_dark=False, title_section="Workspace"):
    bg = (22, 17, 26) if is_dark else (251, 250, 252)
    card_bg = (32, 24, 38) if is_dark else (255, 255, 255)
    border = (53, 42, 59) if is_dark else (234, 228, 237)
    ink = (242, 237, 245) if is_dark else (37, 31, 41)
    muted = (163, 149, 170) if is_dark else (98, 89, 104)
    accent = (229, 75, 156) if is_dark else (180, 33, 112)

    # Base background
    draw.rectangle([(0, 0), (width, height)], fill=bg)

    # Top Window Bar
    bar_height = 48
    draw.rectangle([(0, 0), (width, bar_height)], fill=bg)
    draw.line([(0, bar_height), (width, bar_height)], fill=border, width=1)

    # Breadcrumbs
    f_crumb = get_font(12, bold=False)
    f_crumb_b = get_font(12, bold=True)
    draw.text((22, 16), "Yoinkstagram", fill=muted, font=f_crumb)
    draw.text((106, 16), "/", fill=muted, font=f_crumb)
    draw.text((120, 16), title_section, fill=ink, font=f_crumb_b)

    # Window bar actions (right side)
    # Theme pill
    theme_pill_w = 78
    theme_x = width - 360
    draw_rounded_rect(draw, [(theme_x, 10), (theme_x + theme_pill_w, 38)], radius=14, fill=card_bg, outline=border)
    draw.ellipse([(theme_x + 12, 19), (theme_x + 22, 29)], fill=accent if is_dark else (243, 125, 66))
    draw.text((theme_x + 30, 16), "Light" if is_dark else "Dark", fill=ink, font=get_font(11, bold=True))

    # GitHub pill
    gh_w = 82
    gh_x = width - 272
    draw_rounded_rect(draw, [(gh_x, 10), (gh_x + gh_w, 38)], radius=14, fill=card_bg, outline=border)
    draw.text((gh_x + 14, 16), "★ GitHub", fill=ink, font=get_font(11, bold=True))

    # Account pill
    acc_w = 150
    acc_x = width - 180
    draw_rounded_rect(draw, [(acc_x, 10), (acc_x + acc_w, 38)], radius=14, fill=card_bg, outline=border)
    draw.ellipse([(acc_x + 12, 20), (acc_x + 20, 28)], fill=(56, 148, 93))
    draw.text((acc_x + 28, 16), "@mehenuf", fill=ink, font=get_font(11, bold=True))

    # Left Sidebar Rail
    rail_w = 175
    draw.rectangle([(0, bar_height), (rail_w, height)], fill=card_bg if not is_dark else (26, 19, 31))
    draw.line([(rail_w, bar_height), (rail_w, height)], fill=border, width=1)

    # Brand
    draw_rounded_rect(draw, [(18, bar_height + 16), (46, bar_height + 44)], radius=8, fill=accent)
    draw.text((54, bar_height + 21), "Yoinkstagram", fill=ink, font=get_font(14, bold=True))

    # Nav links
    nav_items = [("Workspace", True), ("Queue (1)", False), ("History", False), ("Settings", False)]
    y_nav = bar_height + 66
    for label, active in nav_items:
        if active:
            highlight_bg = (56, 28, 52) if is_dark else (255, 241, 240)
            highlight_border = (85, 39, 79) if is_dark else (243, 229, 240)
            draw_rounded_rect(draw, [(12, y_nav), (rail_w - 12, y_nav + 34)], radius=10, fill=highlight_bg, outline=highlight_border)
            draw.text((26, y_nav + 9), label, fill=accent, font=get_font(12, bold=True))
        else:
            draw.text((26, y_nav + 9), label, fill=muted, font=get_font(12, bold=False))
        y_nav += 42

    # Rail footer: Author & Version
    draw.line([(12, height - 72), (rail_w - 12, height - 72)], fill=border, width=1)
    draw.text((18, height - 60), "By Md. Mehenuf H. B.", fill=ink, font=get_font(10, bold=True))
    draw_rounded_rect(draw, [(18, height - 36), (62, height - 18)], radius=9, fill=(58, 28, 53) if is_dark else (249, 220, 233))
    draw.text((25, height - 33), "v1.1.0", fill=accent, font=get_font(9, bold=True))
    draw.text((72, height - 33), "MIT Open Source", fill=muted, font=get_font(9, bold=False))

    return {
        "rail_w": rail_w,
        "bar_h": bar_height,
        "ink": ink,
        "muted": muted,
        "border": border,
        "card_bg": card_bg,
        "accent": accent,
        "bg": bg,
    }


# =========================================================================
# 1. GENERATE DEMO-QUEUE.GIF
# =========================================================================
def generate_queue_gif():
    print("Generating demo-queue.gif...")
    width, height = 820, 470
    frames = []

    # Sequence steps:
    # 0-5: Empty input
    # 6-15: Typing handle "@natgeo"
    # 16-24: Toggling chips (Posts, Reels, Stories)
    # 25-32: Clicking "Add to queue" button (ripple/hover)
    # 33-42: Toast notification appears "Added to the download queue."

    handle_text = "@natgeo"

    total_frames = 38
    for i in range(total_frames):
        im = Image.new("RGB", (width, height))
        draw = ImageDraw.Draw(im)
        theme = draw_window_frame(draw, width, height, is_dark=False, title_section="Workspace")

        # Workspace Card
        card_x = theme["rail_w"] + 20
        card_y = theme["bar_h"] + 20
        card_w = width - card_x - 20
        card_h = height - card_y - 20
        draw_rounded_rect(draw, [(card_x, card_y), (card_x + card_w, card_y + card_h)], radius=18, fill=theme["card_bg"], outline=theme["border"])

        # Card Header
        draw_rounded_rect(draw, [(card_x + 18, card_y + 16), (card_x + 48, card_y + 46)], radius=10, fill=(254, 238, 246))
        draw.text((card_x + 28, card_y + 23), "↓", fill=theme["accent"], font=get_font(14, bold=True))
        draw.text((card_x + 58, card_y + 22), "New Download Job", fill=theme["ink"], font=get_font(15, bold=True))

        # Target Type Selector
        draw_rounded_rect(draw, [(card_x + card_w - 145, card_y + 16), (card_x + card_w - 18, card_y + 46)], radius=15, fill=(250, 247, 251), outline=theme["border"])
        draw.text((card_x + card_w - 130, card_y + 24), "User Profile  ▾", fill=theme["ink"], font=get_font(11, bold=True))

        # Input Box
        input_y = card_y + 72
        draw.text((card_x + 20, input_y), "Target Handle or Profile Link", fill=theme["muted"], font=get_font(11, bold=True))

        input_box_y = input_y + 22
        is_focused = i >= 3
        draw_rounded_rect(draw, [(card_x + 20, input_box_y), (card_x + card_w - 20, input_box_y + 42)],
                          radius=12, fill=(255, 255, 255), outline=theme["accent"] if is_focused else theme["border"], width=2 if is_focused else 1)

        # Typing animation
        typed_chars = min(len(handle_text), max(0, i - 4))
        current_text = handle_text[:typed_chars]
        draw.text((card_x + 36, input_box_y + 12), current_text, fill=theme["ink"], font=get_font(13, bold=True))
        if i >= 4 and i % 4 < 2:  # Blinking cursor
            cursor_x = card_x + 36 + len(current_text) * 8
            draw.line([(cursor_x, input_box_y + 10), (cursor_x, input_box_y + 32)], fill=theme["accent"], width=2)

        # Content Toggle Chips
        chips_y = input_box_y + 60
        draw.text((card_x + 20, chips_y), "Content Categories", fill=theme["muted"], font=get_font(11, bold=True))

        chips = ["Posts", "Reels", "Stories", "Highlights", "Metadata JSON"]
        chip_x = card_x + 20
        chip_y = chips_y + 22
        for idx, chip in enumerate(chips):
            is_active = (i < 12 and idx < 2) or (i >= 12 and idx < 4) or (i >= 20 and idx < 5)
            chip_w = len(chip) * 8 + 32
            fill_c = (255, 241, 248) if is_active else (250, 247, 251)
            border_c = (239, 185, 219) if is_active else theme["border"]
            draw_rounded_rect(draw, [(chip_x, chip_y), (chip_x + chip_w, chip_y + 30)], radius=15, fill=fill_c, outline=border_c)
            check = "✓ " if is_active else "+ "
            draw.text((chip_x + 10, chip_y + 7), check + chip, fill=theme["accent"] if is_active else theme["muted"], font=get_font(11, bold=is_active))
            chip_x += chip_w + 10

        # Action Buttons
        btn_y = card_y + card_h - 65
        draw.line([(card_x, btn_y - 12), (card_x + card_w, btn_y - 12)], fill=theme["border"], width=1)

        # Settings button
        draw_rounded_rect(draw, [(card_x + 20, btn_y), (card_x + 140, btn_y + 38)], radius=12, fill=(250, 247, 251), outline=theme["border"])
        draw.text((card_x + 38, btn_y + 11), "⚙ Target Rules", fill=theme["muted"], font=get_font(11, bold=True))

        # Add to Queue CTA
        btn_cta_w = 150
        btn_cta_x = card_x + card_w - btn_cta_w - 20
        is_btn_hover = (24 <= i <= 28)
        cta_bg = (165, 38, 113) if not is_btn_hover else (195, 45, 130)
        draw_rounded_rect(draw, [(btn_cta_x, btn_y), (btn_cta_x + btn_cta_w, btn_y + 38)], radius=12, fill=cta_bg)
        draw.text((btn_cta_x + 28, btn_y + 11), "Add to queue →", fill=(255, 255, 255), font=get_font(12, bold=True))

        # Simulated Cursor
        if 8 <= i <= 27:
            cur_t = (i - 8) / 19.0
            cur_x = int(card_x + 100 + (btn_cta_x + 70 - (card_x + 100)) * cur_t)
            cur_y = int(input_box_y + 20 + (btn_y + 20 - (input_box_y + 20)) * cur_t)
            draw.polygon([(cur_x, cur_y), (cur_x, cur_y + 16), (cur_x + 5, cur_y + 12), (cur_x + 12, cur_y + 12)], fill=(40, 30, 45), outline=(255, 255, 255))

        # Toast notification after queue
        if i >= 28:
            toast_w = 270
            toast_h = 38
            toast_x = width - toast_w - 30
            toast_y = height - toast_h - 25
            draw_rounded_rect(draw, [(toast_x, toast_y), (toast_x + toast_w, toast_y + toast_h)], radius=10, fill=(255, 246, 251), outline=(227, 201, 225))
            draw.text((toast_x + 14, toast_y + 11), "✓ Added @natgeo to download queue", fill=theme["accent"], font=get_font(11, bold=True))

        frames.append(im)

    frames[0].save(ASSETS_DIR / "demo-queue.gif", save_all=True, append_images=frames[1:], duration=130, loop=0, optimize=True)
    print("Saved docs/assets/demo-queue.gif")


# =========================================================================
# 2. GENERATE DEMO-THEME.GIF
# =========================================================================
def generate_theme_gif():
    print("Generating demo-theme.gif...")
    width, height = 820, 470
    frames = []

    # Frames 0-14: Light Mode
    # Frames 15-28: Dark Mode transition
    # Frames 29-36: Return to Light Mode
    total_frames = 34

    for i in range(total_frames):
        is_dark = (14 <= i < 28)
        im = Image.new("RGB", (width, height))
        draw = ImageDraw.Draw(im)
        theme = draw_window_frame(draw, width, height, is_dark=is_dark, title_section="Settings & Appearance")

        card_x = theme["rail_w"] + 24
        card_y = theme["bar_h"] + 24
        card_w = width - card_x - 24
        card_h = height - card_y - 24

        # Settings Card
        draw_rounded_rect(draw, [(card_x, card_y), (card_x + card_w, card_y + card_h)], radius=18, fill=theme["card_bg"], outline=theme["border"])

        # Page Heading
        draw.text((card_x + 24, card_y + 24), "Appearance & Theme", fill=theme["ink"], font=get_font(18, bold=True))
        draw.text((card_x + 24, card_y + 50), "Customize the workspace styling for comfortable daytime or low-light viewing.", fill=theme["muted"], font=get_font(11))

        # Appearance Row
        row_y = card_y + 90
        draw_rounded_rect(draw, [(card_x + 20, row_y), (card_x + card_w - 20, row_y + 74)], radius=14, fill=theme["bg"], outline=theme["border"])

        draw_rounded_rect(draw, [(card_x + 36, row_y + 17), (card_x + 76, row_y + 57)], radius=12, fill=(60, 26, 52) if is_dark else (254, 238, 246))
        draw.text((card_x + 50, row_y + 26), "☾" if is_dark else "☼", fill=theme["accent"], font=get_font(16, bold=True))

        draw.text((card_x + 92, row_y + 20), "Workspace Theme", fill=theme["ink"], font=get_font(13, bold=True))
        draw.text((card_x + 92, row_y + 40), "Select Light, Dark, or automatically synchronize with Windows 11 system theme.", fill=theme["muted"], font=get_font(11))

        # Theme Radio Pills
        pills_x = card_x + card_w - 240
        pills_y = row_y + 20
        draw_rounded_rect(draw, [(pills_x, pills_y), (pills_x + 210, pills_y + 34)], radius=12, fill=theme["card_bg"], outline=theme["border"])

        # Light pill
        light_active = not is_dark
        if light_active:
            draw_rounded_rect(draw, [(pills_x + 2, pills_y + 2), (pills_x + 68, pills_y + 32)], radius=10, fill=(255, 255, 255), outline=(235, 215, 230))
        draw.text((pills_x + 18, pills_y + 9), "☼ Light", fill=theme["accent"] if light_active else theme["muted"], font=get_font(11, bold=light_active))

        # Dark pill
        dark_active = is_dark
        if dark_active:
            draw_rounded_rect(draw, [(pills_x + 72, pills_y + 2), (pills_x + 138, pills_y + 32)], radius=10, fill=(52, 30, 53), outline=(85, 39, 79))
        draw.text((pills_x + 88, pills_y + 9), "☾ Dark", fill=theme["accent"] if dark_active else theme["muted"], font=get_font(11, bold=dark_active))

        # System pill
        draw.text((pills_x + 152, pills_y + 9), "System", fill=theme["muted"], font=get_font(11, bold=False))

        # About Card Row
        about_y = row_y + 90
        draw_rounded_rect(draw, [(card_x + 20, about_y), (card_x + card_w - 20, about_y + 110)], radius=14, fill=theme["bg"], outline=theme["border"])
        draw.text((card_x + 36, about_y + 20), "Yoinkstagram v1.1.0", fill=theme["ink"], font=get_font(14, bold=True))
        draw.text((card_x + 36, about_y + 44), "Created by Md. Mehenuf Hossain Bhuiyan", fill=theme["accent"], font=get_font(12, bold=True))
        draw.text((card_x + 36, about_y + 68), "Local, private, DPAPI encrypted Instagram archiver under the MIT License.", fill=theme["muted"], font=get_font(11))

        # GitHub Repo Button inside About
        draw_rounded_rect(draw, [(card_x + card_w - 180, about_y + 35), (card_x + card_w - 40, about_y + 75)], radius=12, fill=theme["card_bg"], outline=theme["border"])
        draw.text((card_x + card_w - 160, about_y + 47), "★ GitHub Repo", fill=theme["ink"], font=get_font(11, bold=True))

        # Animated Cursor moving to toggle theme
        if 8 <= i <= 16:
            t = (i - 8) / 8.0
            cx = int(card_x + 200 + (pills_x + 105 - (card_x + 200)) * t)
            cy = int(about_y - 20 + (pills_y + 17 - (about_y - 20)) * t)
            draw.polygon([(cx, cy), (cx, cy + 16), (cx + 5, cy + 12), (cx + 12, cy + 12)], fill=(40, 30, 45) if not is_dark else (250, 250, 250), outline=(255, 255, 255) if not is_dark else (0, 0, 0))

        frames.append(im)

    frames[0].save(ASSETS_DIR / "demo-theme.gif", save_all=True, append_images=frames[1:], duration=150, loop=0, optimize=True)
    print("Saved docs/assets/demo-theme.gif")


# =========================================================================
# 3. GENERATE DEMO-DOWNLOAD.GIF
# =========================================================================
def generate_download_gif():
    print("Generating demo-download.gif...")
    width, height = 820, 470
    frames = []

    total_frames = 36
    for i in range(total_frames):
        im = Image.new("RGB", (width, height))
        draw = ImageDraw.Draw(im)
        theme = draw_window_frame(draw, width, height, is_dark=True, title_section="Download Queue")

        card_x = theme["rail_w"] + 20
        card_y = theme["bar_h"] + 20
        card_w = width - card_x - 20
        card_h = height - card_y - 20

        draw_rounded_rect(draw, [(card_x, card_y), (card_x + card_w, card_y + card_h)], radius=18, fill=theme["card_bg"], outline=theme["border"])

        # Heading
        draw.text((card_x + 22, card_y + 20), "Active Archival Engine", fill=theme["ink"], font=get_font(16, bold=True))

        # Calculation of progress
        pct = min(100, int((i / float(total_frames - 8)) * 100))
        is_done = pct >= 100
        file_count = int(pct * 1.84)

        # Job Row Card
        job_y = card_y + 60
        draw_rounded_rect(draw, [(card_x + 18, job_y), (card_x + card_w - 18, job_y + 115)], radius=14, fill=theme["bg"], outline=theme["border"])

        # Icon
        draw_rounded_rect(draw, [(card_x + 34, job_y + 16), (card_x + 72, job_y + 54)], radius=12, fill=(51, 30, 51))
        draw.text((card_x + 46, job_y + 24), "⚡", fill=theme["accent"], font=get_font(16, bold=True))

        # Title & Target
        draw.text((card_x + 86, job_y + 18), "Archive User @natgeo", fill=theme["ink"], font=get_font(14, bold=True))
        draw.text((card_x + 86, job_y + 38), "Target: Full Profile • Posts, Reels, Metadata, Sidecars", fill=theme["muted"], font=get_font(11))

        # Status badge
        badge_x = card_x + card_w - 150
        badge_y = job_y + 18
        if not is_done:
            draw_rounded_rect(draw, [(badge_x, badge_y), (badge_x + 115, badge_y + 28)], radius=12, fill=(20, 53, 33))
            draw.ellipse([(badge_x + 10, badge_y + 10), (badge_x + 18, badge_y + 18)], fill=(110, 231, 155))
            draw.text((badge_x + 25, badge_y + 7), "RUNNING", fill=(110, 231, 155), font=get_font(10, bold=True))
        else:
            draw_rounded_rect(draw, [(badge_x, badge_y), (badge_x + 115, badge_y + 28)], radius=12, fill=(20, 53, 33))
            draw.text((badge_x + 18, badge_y + 7), "✓ COMPLETED", fill=(110, 231, 155), font=get_font(10, bold=True))

        # Progress bar
        bar_x = card_x + 86
        bar_y = job_y + 64
        bar_w = card_w - 140
        bar_h = 10
        draw_rounded_rect(draw, [(bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h)], radius=5, fill=(45, 34, 52))

        fill_w = int((pct / 100.0) * bar_w)
        if fill_w > 0:
            draw_rounded_rect(draw, [(bar_x, bar_y), (bar_x + fill_w, bar_y + bar_h)], radius=5, fill=theme["accent"])

        # Progress stats
        draw.text((bar_x, bar_y + 16), f"{pct}% completed", fill=theme["ink"], font=get_font(11, bold=True))
        draw.text((bar_x + 130, bar_y + 16), f"•  {file_count} files saved", fill=theme["muted"], font=get_font(11))
        draw.text((bar_x + 260, bar_y + 16), "•  Pacing: 2.4s jittered backoff", fill=theme["muted"], font=get_font(11))

        # Terminal / Log Output Box
        log_y = job_y + 130
        draw_rounded_rect(draw, [(card_x + 18, log_y), (card_x + card_w - 18, card_y + card_h - 20)], radius=14, fill=(18, 13, 22), outline=theme["border"])

        draw.text((card_x + 34, log_y + 14), "Engine Terminal Output & Checkpoint Streamer", fill=theme["muted"], font=get_font(11, bold=True))

        logs = [
            ("[17:42:01]", "INFO", "Session cookies loaded via Windows DPAPI safeStorage."),
            ("[17:42:02]", "STREAM", "GraphQL Web API endpoint connected (anti-detection jitter active)."),
            ("[17:42:05]", "BATCH", f"Preserving posts 1 to {max(1, file_count)}: high-resolution media & comments sidecar..."),
            ("[17:42:08]", "SAVE", f"Flushed JSON/XZ resumable checkpoint to storage vault."),
        ]
        if is_done:
            logs.append(("[17:42:11]", "SUCCESS", "All 184 media items and metadata verified. Job complete!"))

        ly = log_y + 40
        for time_s, tag, msg in logs:
            draw.text((card_x + 34, ly), time_s, fill=(140, 125, 148), font=get_font(10))
            draw.text((card_x + 104, ly), f"[{tag}]", fill=theme["accent"] if tag in ("INFO", "SUCCESS") else (255, 180, 120), font=get_font(10, bold=True))
            draw.text((card_x + 170, ly), msg, fill=theme["ink"], font=get_font(10))
            ly += 22

        frames.append(im)

    frames[0].save(ASSETS_DIR / "demo-download.gif", save_all=True, append_images=frames[1:], duration=130, loop=0, optimize=True)
    print("Saved docs/assets/demo-download.gif")


if __name__ == "__main__":
    generate_queue_gif()
    generate_theme_gif()
    generate_download_gif()
    print("All operational showcase GIFs successfully generated!")
