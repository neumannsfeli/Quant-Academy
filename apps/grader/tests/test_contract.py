"""Contract tests (tech spec §12): shared fixture of expression pairs, run against the real app."""

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from grader.main import app

client = TestClient(app)
CASES = json.loads((pathlib.Path(__file__).parent / "contract_fixtures.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["submitted"] for c in CASES])
def test_contract(case):
    res = client.post("/grade", json={k: case[k] for k in ("submitted", "answer", "variables", "assumptions")})
    if "expect_error" in case:
        assert res.status_code == 422
        assert res.json()["error"]["code"] == case["expect_error"]
    else:
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["correct"] is case["correct"], body
        assert body["method"] in ("algebraic", "numeric_probe")
        assert body["graderVersion"]


def test_rejects_long_input():
    res = client.post("/grade", json={"submitted": "x+" * 300 + "x", "answer": "x", "variables": ["x"]})
    assert res.status_code in (422, 400)


def test_rejects_deep_nesting():
    res = client.post("/grade", json={"submitted": "(" * 40 + "x" + ")" * 40, "answer": "x", "variables": ["x"]})
    assert res.status_code == 422


def test_health():
    assert client.get("/health").json()["ok"] is True
