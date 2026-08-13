from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_ROOT = Path(__file__).resolve().parent
LESSONS_ROOT = PROJECT_ROOT / "public" / "lessons"
STAGING_ROOT = SCRIPT_ROOT / "staging"
REPORTS_ROOT = SCRIPT_ROOT / "reports"
PILOT_PLAN_PATH = SCRIPT_ROOT / "pilot-lessons.json"
COURSE_STATUS_PATH = SCRIPT_ROOT / "course-status.json"

DEFAULT_SOURCE_ROOT = Path(
    os.environ.get("SHANGMETHOD_SOURCE_ROOT", PROJECT_ROOT / "course-materials")
).expanduser()
PDF_DIRECTORY_NAME = "100篇演讲稿英汉上下排版-带标注版"
AUDIO_DIRECTORY_NAME = "配套音频MP3"

DURATION_CATEGORIES = (
    (600, "10分钟内"),
    (1200, "10-20分钟"),
    (1800, "20-30分钟"),
    (float("inf"), "30分钟以上"),
)

# The source PDFs use a consistent main column plus a vocabulary strip.
# Filtering is word-coordinate based, so the source PDF is never cropped or changed.
MAIN_COLUMN_RIGHT_RATIO = 0.79
FUZZY_REVIEW_THRESHOLD = 82.0
FUZZY_LOW_THRESHOLD = 72.0


def duration_category(duration_seconds: float) -> str:
    for upper_bound, category in DURATION_CATEGORIES:
        if duration_seconds < upper_bound:
            return category
    raise RuntimeError("Unreachable duration category")


def source_directories(source_root: Path) -> tuple[Path, Path]:
    return (
        source_root / PDF_DIRECTORY_NAME,
        source_root / AUDIO_DIRECTORY_NAME,
    )
