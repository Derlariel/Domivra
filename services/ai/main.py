"""Deterministic anomalies first; an optional provider only explains them."""
from __future__ import annotations

import os
from datetime import date, datetime
from decimal import Decimal
from statistics import median
from typing import Literal

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Domivra insights", version="1.0.0")


class Invoice(BaseModel):
    period: str
    amount: Decimal = Field(ge=0)
    due: date
    status: str


class Payment(BaseModel):
    amount: Decimal = Field(ge=0)
    status: str


class AnalysisRequest(BaseModel):
    invoices: list[Invoice] = Field(default_factory=list)
    payments: list[Payment] = Field(default_factory=list)


class Anomaly(BaseModel):
    kind: Literal["overdue", "high_bill", "unusual_rejection"]
    severity: Literal["info", "warning"]
    count: int
    evidence: dict[str, str | int]
    explanation: str


class AnalysisResponse(BaseModel):
    anomalies: list[Anomaly]
    summary: str
    provider: str


def detect(data: AnalysisRequest, today: date | None = None) -> list[Anomaly]:
    today = today or date.today()
    anomalies: list[Anomaly] = []
    overdue = [x for x in data.invoices if x.status == "published" and x.due < today]
    if overdue:
        anomalies.append(Anomaly(kind="overdue", severity="warning", count=len(overdue),
            evidence={"total": str(sum((x.amount for x in overdue), Decimal(0)))},
            explanation=f"มีบิลเกินกำหนด {len(overdue)} รายการ ควรตรวจยอดรับชำระก่อนติดตามผู้พัก"))
    values = [x.amount for x in data.invoices]
    if len(values) >= 3:
        baseline = Decimal(str(median(values)))
        high = [x for x in data.invoices if baseline > 0 and x.amount > baseline * Decimal("1.5")]
        if high:
            anomalies.append(Anomaly(kind="high_bill", severity="warning", count=len(high),
                evidence={"median": str(baseline), "threshold": str(baseline * Decimal("1.5"))},
                explanation=f"มีบิล {len(high)} รายการสูงกว่าค่ากลางเกิน 50% ควรตรวจมิเตอร์และรายการเพิ่ม"))
    reviewed = [x for x in data.payments if x.status in ("verified", "rejected")]
    rejected = [x for x in reviewed if x.status == "rejected"]
    if len(reviewed) >= 5 and Decimal(len(rejected)) / Decimal(len(reviewed)) > Decimal("0.3"):
        anomalies.append(Anomaly(kind="unusual_rejection", severity="info", count=len(rejected),
            evidence={"reviewed": len(reviewed), "rejected": len(rejected)},
            explanation="สัดส่วนหลักฐานที่ถูกปฏิเสธสูง ควรตรวจคำแนะนำการส่งหลักฐาน"))
    return anomalies


async def explain(anomalies: list[Anomaly]) -> tuple[str, str]:
    provider = os.getenv("LLM_PROVIDER", "disabled").lower()
    fallback = "พบประเด็นที่ควรตรวจสอบตามรายการด้านล่าง" if anomalies else "ยังไม่พบความผิดปกติจากกฎที่กำหนด"
    if provider == "disabled" or not anomalies:
        return fallback, "deterministic"
    if provider != "openai_compatible":
        return fallback, "deterministic"
    url, key, model = (os.getenv(x, "") for x in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"))
    if not url or not key or not model:
        return fallback, "deterministic"
    payload = {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": "Explain only the supplied anomalies in Thai. Return JSON with one key: summary. Never invent figures."},
                     {"role": "user", "content": AnalysisResponse(anomalies=anomalies, summary="", provider="deterministic").model_dump_json()}]}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url.rstrip("/") + "/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=payload)
            response.raise_for_status()
            import json
            parsed = json.loads(response.json()["choices"][0]["message"]["content"])
            summary = parsed.get("summary")
            return (summary[:600], "openai_compatible") if isinstance(summary, str) and summary.strip() else (fallback, "deterministic")
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        return fallback, "deterministic"


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(data: AnalysisRequest) -> AnalysisResponse:
    anomalies = detect(data)
    summary, provider = await explain(anomalies)
    return AnalysisResponse(anomalies=anomalies, summary=summary, provider=provider)
