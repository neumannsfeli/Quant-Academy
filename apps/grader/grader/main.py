"""POST /grade — the grader's whole surface (tech spec §9)."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .equivalence import GRADER_VERSION, GradeError, grade

HANDLER_BUDGET_S = 1.8

app = FastAPI(title="Quant Academy grader", version=GRADER_VERSION, docs_url=None, redoc_url=None)


class GradeRequest(BaseModel):
    kind: Literal["symbolic"] = "symbolic"
    submitted: str = Field(max_length=512)
    answer: str = Field(max_length=1024)
    variables: list[str] = Field(default_factory=list, max_length=16)
    assumptions: dict[str, str] = Field(default_factory=dict)
    probePoints: int = Field(default=20, ge=3, le=100)
    equivalence: Literal["algebraic", "numeric_probe"] = "algebraic"


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.get("/health")
def health():
    return {"ok": True, "graderVersion": GRADER_VERSION}


@app.post("/grade")
async def grade_endpoint(req: GradeRequest):
    loop = asyncio.get_running_loop()
    try:
        verdict = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: grade(req.submitted, req.answer, req.variables, req.assumptions, req.probePoints, req.equivalence),
            ),
            timeout=HANDLER_BUDGET_S,
        )
    except asyncio.TimeoutError:
        return _error(504, "GRADER_TIMEOUT", "grading exceeded its budget")
    except GradeError as e:
        if e.code == "PARSE_ERROR":
            return _error(422, "PARSE_ERROR", e.message)
        if e.code == "BAD_REQUEST":
            return _error(400, "BAD_REQUEST", e.message)
        return _error(500, e.code, e.message)
    return {
        "correct": verdict.correct,
        "method": verdict.method,
        "normalised": verdict.normalised,
        "graderVersion": GRADER_VERSION,
    }
