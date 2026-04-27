#!/usr/bin/env python3
"""Fetch SEC EDGAR company facts and derive dashboard KPIs.

The script uses the public SEC data API:
https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip equivalent
per-company JSON endpoint at data.sec.gov/api/xbrl/companyfacts/CIK##########.json.
"""

from __future__ import annotations

import json
import math
import ssl
import time
import urllib.error
import urllib.request
import gzip
import zlib
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_PATH = DATA_DIR / "sec_company_fundamentals.json"

SEC_HEADERS = {
    "User-Agent": "Insurtech Proptech Dashboard lyubomir.dachev@example.com",
    "Accept-Encoding": "gzip, deflate",
}


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl._create_unverified_context()


SSL_CONTEXT = ssl_context()


@dataclass(frozen=True)
class Company:
    name: str
    ticker: str
    sector: str
    why: str


COMPANIES = [
    Company("Lemonade", "LMND", "Insurtech", "Direct insurtech competitor"),
    Company("Hippo Holdings", "HIPO", "Insurtech", "Home insurance insurtech"),
    Company("American Homes 4 Rent", "AMH", "REIT / Proptech", "Single-family rental operator"),
    Company("NMI Holdings", "NMIH", "Specialty Insurance", "Specialty insurance/risk"),
    Company("Invitation Homes", "INVH", "REIT / Proptech", "Large SFR landlord"),
    Company("Essex Property Trust", "ESS", "REIT / Proptech", "Multifamily REIT"),
]


REVENUE_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "OperatingLeaseLeaseIncome",
    "SalesRevenueNet",
    "RealEstateRevenueNet",
    "RentalIncome",
    "PremiumsEarnedNet",
    "PremiumsEarned",
]

NET_INCOME_TAGS = [
    "NetIncomeLoss",
    "ProfitLoss",
    "NetIncomeLossAvailableToCommonStockholdersBasic",
]

ASSET_TAGS = ["Assets"]

EQUITY_TAGS = [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "PartnersCapital",
]

LIABILITY_TAGS = ["Liabilities"]

DEBT_TAGS = [
    "LongTermDebtAndFinanceLeaseObligations",
    "LongTermDebtAndFinanceLeaseObligationsCurrent",
    "LongTermDebtCurrent",
    "LongTermDebtNoncurrent",
    "DebtCurrent",
    "DebtNoncurrent",
    "ShortTermBorrowings",
]

OPEX_TAGS = [
    "BenefitsLossesAndExpenses",
    "CostsAndExpenses",
    "OperatingExpenses",
    "SellingGeneralAndAdministrativeExpense",
    "GeneralAndAdministrativeExpense",
]


def sec_get(url: str) -> Any:
    req = urllib.request.Request(url, headers=SEC_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as response:
            body = response.read()
            encoding = response.headers.get("Content-Encoding", "").lower()
            if encoding == "gzip":
                body = gzip.decompress(body)
            elif encoding == "deflate":
                body = zlib.decompress(body)
            return json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"SEC request failed for {url}: HTTP {exc.code}") from exc


def get_ticker_map() -> dict[str, str]:
    rows = sec_get("https://www.sec.gov/files/company_tickers.json")
    return {
        row["ticker"].upper(): str(row["cik_str"]).zfill(10)
        for row in rows.values()
    }


def annual_facts(facts: dict[str, Any], tags: list[str]) -> dict[int, float]:
    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    yearly: dict[int, tuple[str, float]] = {}
    for tag in tags:
        fact = us_gaap.get(tag)
        if not fact:
            continue
        for unit_values in fact.get("units", {}).values():
            for item in unit_values:
                if item.get("form") != "10-K" or item.get("fp") != "FY":
                    continue
                fy = item.get("fy")
                val = item.get("val")
                frame = item.get("frame", "")
                if fy is None or val is None:
                    continue
                if frame and not str(frame).startswith("CY"):
                    continue
                try:
                    fy_int = int(fy)
                    val_float = float(val)
                except (TypeError, ValueError):
                    continue
                filed = item.get("filed", "")
                previous = yearly.get(fy_int)
                if previous is None or filed > previous[0]:
                    yearly[fy_int] = (filed, val_float)
    return {fy: value for fy, (_, value) in yearly.items()}


def annual_filing_dates(facts: dict[str, Any], tags: list[str]) -> dict[int, str]:
    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    yearly: dict[int, str] = {}
    for tag in tags:
        fact = us_gaap.get(tag)
        if not fact:
            continue
        for unit_values in fact.get("units", {}).values():
            for item in unit_values:
                if item.get("form") != "10-K" or item.get("fp") != "FY":
                    continue
                fy = item.get("fy")
                filed = item.get("filed", "")
                frame = item.get("frame", "")
                if fy is None or not filed:
                    continue
                if frame and not str(frame).startswith("CY"):
                    continue
                try:
                    fy_int = int(fy)
                except (TypeError, ValueError):
                    continue
                if filed > yearly.get(fy_int, ""):
                    yearly[fy_int] = filed
    return yearly


def latest_and_previous(series: dict[int, float]) -> tuple[int | None, float | None, float | None]:
    years = sorted(series)
    if not years:
        return None, None, None
    latest_year = years[-1]
    latest_value = series[latest_year]
    previous_value = series[years[-2]] if len(years) > 1 else None
    return latest_year, latest_value, previous_value


def latest_value(series: dict[int, float], year: int | None) -> float | None:
    if year is None:
        return None
    if year in series:
        return series[year]
    prior_years = [fy for fy in series if fy <= year]
    if not prior_years:
        return None
    return series[max(prior_years)]


def safe_pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator * 100


def safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def pick_series(facts: dict[str, Any], tags: list[str]) -> tuple[str | None, dict[int, float]]:
    for tag in tags:
        series = annual_facts(facts, [tag])
        if series:
            return tag, series
    return None, {}


def pick_revenue_series(facts: dict[str, Any]) -> tuple[str | None, dict[int, float]]:
    candidates = []
    for tag in REVENUE_TAGS:
        series = annual_facts(facts, [tag])
        if not series:
            continue
        latest_year, latest, previous = latest_and_previous(series)
        if latest_year is None or latest is None or latest <= 0:
            continue
        has_growth = previous not in (None, 0)
        candidates.append((latest_year, has_growth, latest, tag, series))
    if not candidates:
        return None, {}
    latest_year = max(candidate[0] for candidate in candidates)
    same_year = [candidate for candidate in candidates if candidate[0] == latest_year]
    same_year.sort(key=lambda candidate: (candidate[1], candidate[2]), reverse=True)
    _, _, _, tag, series = same_year[0]
    return tag, series


def pick_largest_latest_series(
    facts: dict[str, Any],
    tags: list[str],
) -> tuple[str | None, dict[int, float]]:
    candidates = []
    for tag in tags:
        series = annual_facts(facts, [tag])
        if not series:
            continue
        latest_year, latest, _ = latest_and_previous(series)
        if latest_year is None or latest is None or latest < 0:
            continue
        candidates.append((latest_year, latest, tag, series))
    if not candidates:
        return None, {}
    latest_year = max(candidate[0] for candidate in candidates)
    same_year = [candidate for candidate in candidates if candidate[0] == latest_year]
    same_year.sort(key=lambda candidate: candidate[1], reverse=True)
    _, _, tag, series = same_year[0]
    return tag, series


def sum_latest(facts: dict[str, Any], tags: list[str], year: int | None) -> float | None:
    total = 0.0
    found = False
    for tag in tags:
        value = latest_value(annual_facts(facts, [tag]), year)
        if value is not None:
            total += value
            found = True
    return total if found else None


def sum_for_year(facts: dict[str, Any], tags: list[str], year: int | None) -> float | None:
    if year is None:
        return None
    total = 0.0
    found = False
    for tag in tags:
        value = annual_facts(facts, [tag]).get(year)
        if value is not None:
            total += value
            found = True
    return total if found else None


def round_or_none(value: float | None, digits: int = 1) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def build_annual_metrics(
    facts: dict[str, Any],
    revenue_series: dict[int, float],
    net_income_series: dict[int, float],
    asset_series: dict[int, float],
    equity_series: dict[int, float],
    liability_series: dict[int, float],
    opex_series: dict[int, float],
    years: int = 5,
) -> list[dict[str, float | int | None]]:
    history = []
    for fiscal_year in sorted(revenue_series)[-years:]:
        revenue = revenue_series.get(fiscal_year)
        previous_revenue = revenue_series.get(fiscal_year - 1)
        net_income = latest_value(net_income_series, fiscal_year)
        assets = latest_value(asset_series, fiscal_year)
        equity = latest_value(equity_series, fiscal_year)
        liabilities = latest_value(liability_series, fiscal_year)
        debt = sum_for_year(facts, DEBT_TAGS, fiscal_year) or liabilities
        opex = latest_value(opex_series, fiscal_year)
        revenue_growth = safe_pct(
            None if revenue is None or previous_revenue is None else revenue - previous_revenue,
            previous_revenue,
        )
        history.append(
            {
                "fiscal_year": fiscal_year,
                "revenue_m": round_or_none(revenue / 1_000_000 if revenue is not None else None, 1),
                "revenue_growth_pct": round_or_none(revenue_growth, 1),
                "net_margin_pct": round_or_none(safe_pct(net_income, revenue), 1),
                "roa_pct": round_or_none(safe_pct(net_income, assets), 1),
                "debt_to_equity": round_or_none(safe_ratio(debt, equity), 2),
                "opex_ratio_pct": round_or_none(safe_pct(opex, revenue), 1),
            }
        )
    return history


def analyst_summary(company: Company, metrics: dict[str, float | int | None]) -> str:
    rev = metrics["revenue_m"]
    growth = metrics["revenue_growth_pct"]
    margin = metrics["net_margin_pct"]
    roa = metrics["roa_pct"]
    de = metrics["debt_to_equity"]
    opex = metrics["opex_ratio_pct"]

    if company.ticker == "LMND":
        return (
            f"Lemonade remains a high-growth insurtech with revenue growth of {growth:.1f}% but a deeply negative "
            f"net margin of {margin:.1f}%. Its biggest strength is brand-led digital distribution, while the key "
            f"risk is operating intensity, reflected in an OpEx ratio of {opex:.1f}% and continued cash-burn pressure. "
            "Relative to REITs and specialty insurers, the company is still proving whether growth can convert into durable underwriting profit."
        )
    if company.ticker == "HIPO":
        return (
            f"Hippo is the weakest financial performer in the peer set, with revenue of ${rev:.1f}M and a "
            f"net margin of {margin:.1f}%. Its strength is exposure to the home insurance modernization theme, "
            "but the company still carries meaningful execution risk because losses remain large relative to revenue. "
            "The industry context is unforgiving: investors are rewarding insurtech scale only when it comes with a credible path to profitability."
        )
    if company.ticker == "NMIH":
        return (
            f"NMI Holdings is the strongest performer in the group, pairing a {margin:.1f}% net margin with "
            f"ROA of {roa:.1f}% and conservative leverage of {de:.2f}x. Its biggest strength is profitable specialty "
            "insurance underwriting with disciplined capital use. The main risk is cyclicality in housing and mortgage credit conditions, "
            "but its profitability profile stands well above both insurtech and REIT peers."
        )
    if company.ticker in {"AMH", "INVH", "ESS"}:
        return (
            f"{company.name} is a mature property platform with revenue of ${rev:.1f}M, growth of {growth:.1f}%, "
            f"and a positive net margin of {margin:.1f}%. Its biggest strength is scale and recurring rental income, "
            "while the main risk is balance-sheet sensitivity to rates and real-estate cycles. Compared with insurtech peers, "
            "the company offers slower growth but far more stable profitability."
        )
    return (
        f"{company.name} shows revenue of ${rev:.1f}M, growth of {growth:.1f}%, and net margin of {margin:.1f}%. "
        "Its positioning is best interpreted against the broader peer group because scale, profitability, and capital structure vary sharply. "
        "The key watch item is whether financial performance improves without sacrificing growth. "
        "Industry context matters because public market comparables are separating durable earnings from growth that requires heavy reinvestment."
    )


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    ticker_map = get_ticker_map()
    company_rows = []

    for company in COMPANIES:
        cik = ticker_map[company.ticker]
        print(f"Fetching {company.ticker} CIK {cik}")
        facts = sec_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
        time.sleep(0.15)

        revenue_tag, revenue_series = pick_revenue_series(facts)
        fiscal_year, revenue, previous_revenue = latest_and_previous(revenue_series)
        filing_dates = annual_filing_dates(facts, [revenue_tag] if revenue_tag else REVENUE_TAGS)
        _, net_income_series = pick_series(facts, NET_INCOME_TAGS)
        _, asset_series = pick_series(facts, ASSET_TAGS)
        _, equity_series = pick_series(facts, EQUITY_TAGS)
        _, liability_series = pick_series(facts, LIABILITY_TAGS)
        _, opex_series = pick_largest_latest_series(facts, OPEX_TAGS)

        net_income = latest_value(net_income_series, fiscal_year)
        assets = latest_value(asset_series, fiscal_year)
        equity = latest_value(equity_series, fiscal_year)
        liabilities = latest_value(liability_series, fiscal_year)
        debt = sum_latest(facts, DEBT_TAGS, fiscal_year) or liabilities
        opex = latest_value(opex_series, fiscal_year)

        revenue_growth = safe_pct(
            None if revenue is None or previous_revenue is None else revenue - previous_revenue,
            previous_revenue,
        )
        net_margin = safe_pct(net_income, revenue)
        roa = safe_pct(net_income, assets)
        debt_to_equity = safe_ratio(debt, equity)
        opex_ratio = safe_pct(opex, revenue)

        metrics = {
            "fiscal_year": fiscal_year,
            "revenue_m": round_or_none(revenue / 1_000_000 if revenue is not None else None, 1),
            "revenue_growth_pct": round_or_none(revenue_growth, 1),
            "net_margin_pct": round_or_none(net_margin, 1),
            "roa_pct": round_or_none(roa, 1),
            "debt_to_equity": round_or_none(debt_to_equity, 2),
            "opex_ratio_pct": round_or_none(opex_ratio, 1),
        }
        annual_metrics = build_annual_metrics(
            facts,
            revenue_series,
            net_income_series,
            asset_series,
            equity_series,
            liability_series,
            opex_series,
        )

        company_rows.append(
            {
                "company": company.name,
                "ticker": company.ticker,
                "sector": company.sector,
                "why": company.why,
                "cik": cik,
                "filing_date": filing_dates.get(fiscal_year),
                "revenue_tag": revenue_tag,
                "metrics": metrics,
                "annual_metrics": annual_metrics,
                "analysis": analyst_summary(company, metrics),
            }
        )

    peer_averages = {}
    metric_names = [
        "revenue_m",
        "revenue_growth_pct",
        "net_margin_pct",
        "roa_pct",
        "debt_to_equity",
        "opex_ratio_pct",
    ]
    for metric_name in metric_names:
        values = [
            row["metrics"][metric_name]
            for row in company_rows
            if row["metrics"][metric_name] is not None
        ]
        peer_averages[metric_name] = round(sum(values) / len(values), 2) if values else None

    payload = {
        "metadata": {
            "title": "Insurtech & Proptech Competitive Intelligence Dashboard",
            "source": "SEC EDGAR companyfacts API, latest annual 10-K facts",
            "prepared_by": "Lyubomir Dachev",
            "school": "Fordham Gabelli School of Business",
            "generated_on": date.today().isoformat(),
        },
        "companies": company_rows,
        "peer_averages": peer_averages,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
