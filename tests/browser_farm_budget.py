"""Season-budget acceptance using local files and user-entered fixture values.

No account, real farm finances, API, storage service or production site is used.
All requests are intercepted; the calculator must not make any data requests.
"""
from pathlib import Path
from urllib.parse import urlparse, unquote
import csv
import io
import json
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def shown_number(page, selector):
    value = page.locator(selector).inner_text().translate(DIGITS)
    value = value.replace("٬", "").replace(",", "").replace("٫", ".").replace("−", "-")
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    assert match, (selector, value)
    return float(match.group())


def row(page, index):
    return page.locator(".cost-row").nth(index)


def set_cost(page, index, label, quantity, price, basis):
    item = row(page, index)
    item.locator('[data-field="label"]').fill(label)
    item.locator('[data-field="quantity"]').fill(str(quantity))
    item.locator('[data-field="unitCostIqd"]').fill(str(price))
    item.locator('[data-field="basis"]').select_option(basis)


def calculate(page):
    page.locator("#calculateBudget").click()
    page.wait_for_selector("#resultSection:not([hidden])")
    assert page.locator("#downloadBudgetJson").is_enabled()


def download_json(page):
    with page.expect_download() as pending:
        page.locator("#downloadBudgetJson").click()
    value = json.loads(Path(pending.value.path()).read_text(encoding="utf-8-sig"))
    # Export may carry a descriptive envelope alongside the actual result.
    if "total_cost_iqd" in value:
        return value, value
    for name in ("result", "budget", "results", "calculation"):
        if isinstance(value.get(name), dict) and "total_cost_iqd" in value[name]:
            return value[name], value
    raise AssertionError("JSON export did not contain the calculated result")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        for mobile in (False, True):
            context = browser.new_context(
                viewport={"width": 390 if mobile else 1440, "height": 844 if mobile else 1000},
                is_mobile=mobile, has_touch=mobile, accept_downloads=True,
            )
            external, data_requests, errors = [], [], []

            def serve(route):
                parsed = urlparse(route.request.url)
                if route.request.resource_type in ("fetch", "xhr", "websocket"):
                    data_requests.append(route.request.url)
                if parsed.hostname == "ur-budget.test":
                    path = (ROOT / unquote(parsed.path).lstrip("/")).resolve()
                    if path.is_relative_to(ROOT) and path.is_file():
                        mime = {".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css"}.get(path.suffix, "text/html")
                        route.fulfill(body=path.read_bytes(), content_type=mime)
                        return
                    route.fulfill(status=404, body="Not found")
                    return
                external.append(route.request.url)
                route.abort()

            context.route("**/*", serve)
            page = context.new_page()
            page.set_default_timeout(10000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto("https://ur-budget.test/farm-budget.html")
            page.wait_for_selector("#budgetForm")
            assert page.locator("html").get_attribute("dir") == "rtl"
            assert page.locator('meta[http-equiv="Content-Security-Policy"]').count() == 1
            assert page.locator("#areaValue").input_value() == ""
            assert page.locator("#yieldKgPerDonum").input_value() == ""
            assert page.locator("#salePriceIqdPerKg").input_value() == ""
            assert page.locator(".cost-row").count() == 1

            # Native required fields/validation cannot turn an empty form into profit.
            page.locator("#calculateBudget").click()
            assert page.locator("#resultSection").is_hidden()
            assert page.locator("#downloadBudgetJson").is_disabled()

            # One Iraqi donum is2500m²; per-donum costs must scale with the area.
            page.locator("#areaUnit").select_option("m2")
            page.locator("#areaValue").fill("5000")
            set_cost(page, 0, "بذور", 3, 10000, "per_donum")
            page.locator("#addCost").click()
            set_cost(page, 1, "عمالة", 1, 20000, "total")
            page.locator("#yieldKgPerDonum").fill("1000")
            page.locator("#salePriceIqdPerKg").fill("500")
            calculate(page)
            for selector, expected in {
                "#totalCost": 80000, "#costPerDonum": 40000,
                "#expectedProduction": 2000, "#expectedRevenue": 1000000,
                "#expectedMargin": 920000, "#breakEvenPrice": 40, "#breakEvenYield": 80,
            }.items():
                assert shown_number(page, selector) == expected, (selector, page.locator(selector).inner_text())
            result, exported = download_json(page)
            assert result["area_donum"] == 2
            assert result["total_cost_iqd"] == 80000
            assert result["expected_revenue_iqd"] == 1000000
            assert result["expected_margin_iqd"] == 920000
            assert result["break_even_price_iqd_per_kg"] == 40
            assert result["break_even_yield_kg_per_donum"] == 80
            assert all(isinstance(result[key], (int, float)) for key in ("area_donum", "total_cost_iqd", "expected_revenue_iqd"))

            # Edits make the old calculation visibly stale and stop stale exports.
            row(page, 0).locator('[data-field="label"]').fill("=1+1")
            assert page.locator("#staleNotice").is_visible()
            assert page.locator("#downloadBudgetJson").is_disabled()
            assert page.locator("#downloadBudgetCsv").is_disabled()
            calculate(page)
            with page.expect_download() as pending:
                page.locator("#downloadBudgetCsv").click()
            raw_csv = Path(pending.value.path()).read_text(encoding="utf-8-sig")
            cells = [cell for values in csv.reader(io.StringIO(raw_csv)) for cell in values]
            assert "'=1+1" in cells, "CSV must neutralize a user label that Excel treats as a formula"
            assert "=1+1" not in cells
            assert page.locator("#resultSection script,#resultSection img").count() == 0

            # Missing assumptions stay unknown instead of showing zero revenue.
            page.locator("#yieldKgPerDonum").fill("")
            calculate(page)
            result, _ = download_json(page)
            assert result["expected_production_kg"] is None
            assert result["expected_revenue_iqd"] is None
            assert result["expected_margin_iqd"] is None
            assert result["break_even_price_iqd_per_kg"] is None
            assert result["break_even_yield_kg_per_donum"] == 80
            assert "غير متاح" in page.locator("#expectedRevenue").inner_text()

            # Explicit zero is valid data: no production and a negative entered-cost margin.
            page.locator("#yieldKgPerDonum").fill("0")
            calculate(page)
            result, _ = download_json(page)
            assert result["expected_production_kg"] == 0
            assert result["expected_revenue_iqd"] == 0
            assert result["expected_margin_iqd"] == -80000
            assert result["break_even_price_iqd_per_kg"] is None
            page.locator("#yieldKgPerDonum").fill("1000")
            page.locator("#salePriceIqdPerKg").fill("0")
            calculate(page)
            result, _ = download_json(page)
            assert result["expected_revenue_iqd"] == 0
            assert result["expected_margin_iqd"] == -80000
            assert result["break_even_yield_kg_per_donum"] is None

            # Reject negative areas and incomplete cost descriptions; do not export an old result.
            page.locator("#areaValue").fill("-1")
            page.locator("#calculateBudget").click()
            assert page.locator("#downloadBudgetJson").is_disabled()
            assert page.locator("#areaValue").evaluate("input=>!input.checkValidity()") or page.locator("#formStatus").inner_text().strip()
            page.locator("#areaValue").fill("5000")
            row(page, 0).locator('[data-field="label"]').fill("")
            page.locator("#calculateBudget").click()
            assert page.locator("#downloadBudgetJson").is_disabled()
            row(page, 0).locator('[data-field="label"]').fill("بذور")
            page.locator("#salePriceIqdPerKg").fill("500")

            # Adding and removing a cost changes the actual sum; max50rows protects the page.
            row(page, 1).locator(".remove-cost").click()
            assert page.locator(".cost-row").count() == 1
            calculate(page)
            assert shown_number(page, "#totalCost") == 60000
            assert shown_number(page, "#expectedMargin") == 940000
            page.evaluate("() => {window.__printCalls=0;window.print=()=>{window.__printCalls++;};}")
            page.locator("#printBudget").click()
            assert page.evaluate("window.__printCalls") == 1, {
                'print_calls': page.evaluate("window.__printCalls"),
                'print_function': page.evaluate("String(window.print)"),
                'button': page.locator('#printBudget').evaluate("e=>({disabled:e.disabled,type:e.type})"),
                'stale': page.locator('#staleNotice').is_visible(),
                'errors': errors,
            }
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")

            page.screenshot(path="/tmp/ur-budget-" + ("mobile" if mobile else "desktop") + ".png", full_page=True)

            # Unit-price thresholds retain three decimals rather than looking
            # cheaper or becoming zero after a two-decimal currency formatter.
            page.locator("#areaUnit").select_option("donum")
            page.locator("#areaValue").fill("1")
            set_cost(page, 0, "سعر كسري", 1, 4, "total")
            page.locator("#yieldKgPerDonum").fill("1000")
            page.locator("#salePriceIqdPerKg").fill("0.014")
            calculate(page)
            assert shown_number(page, "#breakEvenPrice") == 0.004
            assert "٠٫٠١٤" in page.locator("#assumptions").inner_text()
            set_cost(page, 0, "سعر كسري", 1000, "0.014", "total")
            calculate(page)
            assert shown_number(page, "#breakEvenPrice") == 0.014
            assert shown_number(page, "#costBreakdown tbody tr td:nth-child(3)") == 0.014
            assert shown_number(page, "#expectedMargin") == 0

            page.evaluate("for(let i=0;i<49;i++)document.querySelector('#addCost').click()")
            assert page.locator(".cost-row").count() == 50
            assert page.locator("#addCost").is_disabled()

            # Clear is deliberate and erases all in-page financial inputs and old output.
            page.locator("#clearBudget").click()
            assert page.locator("#areaValue").input_value() == ""
            assert page.locator("#yieldKgPerDonum").input_value() == ""
            assert page.locator("#salePriceIqdPerKg").input_value() == ""
            assert page.locator(".cost-row").count() == 1
            assert row(page, 0).locator('[data-field="label"]').input_value() == ""
            assert page.locator("#resultSection").is_hidden()
            assert page.locator("#downloadBudgetJson").is_disabled()
            assert page.evaluate("localStorage.length===0&&sessionStorage.length===0")
            assert not external, external
            assert not data_requests, data_requests
            assert not errors, errors
            context.close()
        browser.close()
    print("Farm budget: desktop/mobile area conversion, actual sums and break-even, unknown/zero values, validation, stale exports, safe CSV/JSON, row limit, clear/print and no network/storage passed.")


if __name__ == "__main__":
    main()
