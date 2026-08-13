from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


DurationCategory = Literal[
    "10分钟内",
    "10-20分钟",
    "20-30分钟",
    "30分钟以上",
]


class Sentence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    english: str = Field(min_length=1)
    chinese: str

    @model_validator(mode="after")
    def end_must_follow_start(self) -> "Sentence":
        if self.end <= self.start:
            raise ValueError("sentence end must be greater than start")
        return self


class Transcript(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(min_length=1)
    durationSeconds: float = Field(gt=0)
    durationCategory: DurationCategory
    summary: str = Field(min_length=1)
    audio: str = Field(pattern=r"^/lessons/[a-z0-9-]+/audio\.mp3$")
    translation: str = Field(min_length=1)
    sentences: list[Sentence] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_course_consistency(self) -> "Transcript":
        expected_audio = f"/lessons/{self.id}/audio.mp3"
        if self.audio != expected_audio:
            raise ValueError(f"audio must be {expected_audio}")
        if len({sentence.id for sentence in self.sentences}) != len(self.sentences):
            raise ValueError("sentence ids must be unique")
        return self


class ManifestEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    durationCategory: DurationCategory
    summary: str
    audio: str
    transcript: str


ImportStatus = Literal["pending", "processing", "completed", "failed"]
AlignmentStatus = Literal["pending", "passed", "warning", "failed"]
ReviewStatus = Literal["pending", "approved", "rejected"]


class CourseStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    importStatus: ImportStatus
    alignmentStatus: AlignmentStatus
    transcriptVersion: Literal[1, 2]
    reviewStatus: ReviewStatus
    published: bool
