from datetime import date, timedelta
from decimal import Decimal
from main import AnalysisRequest, Invoice, Payment, detect


def test_detection_uses_numbers_before_explanation():
    yesterday = date.today() - timedelta(days=1)
    data = AnalysisRequest(invoices=[Invoice(period="2026-10", amount=Decimal(x), due=yesterday, status="published") for x in ("100", "100", "200")], payments=[Payment(amount=Decimal("100"), status="verified")])
    kinds = {x.kind for x in detect(data)}
    assert kinds == {"overdue", "high_bill"}
    assert detect(AnalysisRequest()).__len__() == 0
