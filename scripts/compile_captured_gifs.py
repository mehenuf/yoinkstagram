from pathlib import Path
from PIL import Image

BASE_DIR = Path(".temp_frames")
OUT_DIR = Path("docs/assets")
OUT_DIR.mkdir(parents=True, exist_ok=True)

def make_gif(name, duration=140):
    src_dir = BASE_DIR / name
    frames_paths = sorted(src_dir.glob("*.png"))
    if not frames_paths:
        print(f"No frames found for {name}!")
        return

    frames = []
    for p in frames_paths:
        img = Image.open(p).convert("RGBA")
        # Resize slightly to reduce file size while maintaining pixel clarity (e.g. 848x560)
        w, h = img.size
        target_size = (int(w * 0.8), int(h * 0.8))
        resized = img.resize(target_size, Image.Resampling.LANCZOS)
        paletted = resized.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
        frames.append(paletted)

    out_file = OUT_DIR / f"demo-{name}.gif"
    frames[0].save(
        out_file,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        optimize=True,
    )
    print(f"Saved {out_file} ({out_file.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    make_gif("queue", duration=150)
    make_gif("theme", duration=320)
    make_gif("download", duration=220)
    print("All authentic GIFs compiled successfully!")
