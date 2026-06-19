from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "miniprogram" / "assets"
TARGET_SIZE = (320, 320)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
RESAMPLE_FILTER = getattr(Image, "Resampling", Image).LANCZOS


def resize_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """居中裁切为目标比例，再缩放到指定尺寸。"""
    target_w, target_h = size
    src_w, src_h = image.size
    src_ratio = src_w / src_h
    target_ratio = target_w / target_h

    # 先裁掉多余边缘，保留画面中心，避免图片被拉伸变形。
    if src_ratio > target_ratio:
        crop_w = int(src_h * target_ratio)
        left = (src_w - crop_w) // 2
        box = (left, 0, left + crop_w, src_h)
    else:
        crop_h = int(src_w / target_ratio)
        top = (src_h - crop_h) // 2
        box = (0, top, src_w, top + crop_h)

    cropped = image.crop(box)
    return cropped.resize(size, RESAMPLE_FILTER)


def main() -> None:
    for path in sorted(ASSETS_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        old_size = path.stat().st_size
        with Image.open(path) as image:
            # JPG 不支持透明通道，统一转成 RGB 保存。
            resized = resize_cover(image.convert("RGB"), TARGET_SIZE)

        resized.save(path, quality=85, optimize=True)
        new_size = path.stat().st_size
        rel_path = path.relative_to(ROOT)
        print(f"{rel_path}: {old_size} -> {new_size}")


if __name__ == "__main__":
    main()
