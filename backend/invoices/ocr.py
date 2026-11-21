
import os
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Any

import pytesseract
import pymupdf as fitz
from PIL import Image


# --------------------------------------------------
# TESSERACT CONFIGURATION
# --------------------------------------------------

_DEFAULT_TESSERACT_PATH = Path(
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

_TESSERACT_COMMAND = os.environ.get("TESSERACT_CMD")

if not _TESSERACT_COMMAND and os.name == "nt" and _DEFAULT_TESSERACT_PATH.is_file():
    _TESSERACT_COMMAND = str(_DEFAULT_TESSERACT_PATH)

if _TESSERACT_COMMAND:
    pytesseract.pytesseract.tesseract_cmd = _TESSERACT_COMMAND


# --------------------------------------------------
# REGEX PATTERNS
# --------------------------------------------------

_DATE_PATTERN = re.compile(
    r"\b(?:"
    r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
    r"\d{4}[/-]\d{1,2}[/-]\d{1,2}|"
    r"\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|"
    r"[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}"
    r")\b"
)

_AMOUNT_PATTERN = re.compile(
    r"(?<![\w/])"
    r"(?:\(?\s*-?\s*)?"
    r"(?:\d{1,3}(?:,\d{3})+|\d+)"
    r"(?:\.\d{1,2})?"
    r"\s*\)?"
    r"(?![\w.%]|\s*%)"
)


# --------------------------------------------------
# OCR TEXT EXTRACTION
# --------------------------------------------------

def extract_text_from_invoice(file: Any) -> str:
    """Use Tesseract to extract text from an uploaded PDF or image invoice."""

    extension = Path(str(getattr(file, "name", ""))).suffix.lower()

    if extension not in {".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}:
        raise ValueError("Unsupported invoice file format")

    if hasattr(file, "seek"):
        file.seek(0)

    contents = file.read()

    if not contents:
        raise ValueError("The uploaded invoice file is empty")

    if extension == ".pdf":
        page_text = []

        with fitz.open(stream=contents, filetype="pdf") as pdf_document:
            for page in pdf_document:
                pixmap = page.get_pixmap(
                    matrix=fitz.Matrix(1.5, 1.5),
                    alpha=False
                )

                image = Image.frombytes(
                    "RGB",
                    (pixmap.width, pixmap.height),
                    pixmap.samples
                )

                page_text.append(
                   pytesseract.image_to_string(
    image,
    lang="eng",
    timeout=20
)
                )

        extracted_text = "\n".join(page_text)

    else:
        with Image.open(BytesIO(contents)) as source_image:
            extracted_text = pytesseract.image_to_string(
                source_image.convert("RGB"),
                lang="eng"
            )

    return extracted_text.strip()


# --------------------------------------------------
# LABELED VALUE EXTRACTION
# --------------------------------------------------

def _find_labeled_value(
    lines: list[str],
    label_pattern: str
) -> str | None:
    """Return a value following a label, including labels split across lines."""

    for index, line in enumerate(lines):

        match = re.match(
            rf"^\s*(?:{label_pattern})\s*(?:[:#\-]\s*)?(.*?)\s*$",
            line,
            flags=re.IGNORECASE,
        )

        if not match:
            continue

        value = match.group(1).strip()

        if value:
            return value

        for following_line in lines[index + 1:index + 3]:
            value = following_line.strip(" \t:#-")

            if value:
                return value

    return None


# --------------------------------------------------
# DATE PARSING
# --------------------------------------------------

def _parse_date(value: str | None) -> date | None:

    if not value:
        return None

    match = _DATE_PATTERN.search(value)

    if not match:
        return None

    date_text = match.group(0).replace(",", "")

    for date_format in (
        "%d %B %Y",
        "%d %b %Y",
        "%B %d %Y",
        "%b %d %Y",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%m/%d/%y",
        "%m-%d-%y",
        "%Y-%m-%d",
        "%Y/%m/%d",
    ):
        try:
            return datetime.strptime(date_text, date_format).date()

        except ValueError:
            continue

    return None


# --------------------------------------------------
# AMOUNT PARSING
# --------------------------------------------------

def _parse_amount(value: str) -> Decimal | None:

    normalized = value.strip().replace(" ", "")

    is_negative = (
        normalized.startswith("(")
        and normalized.endswith(")")
    )

    normalized = normalized.strip("()")

    normalized = re.sub(
        r"^(?:INR|Rs\.?|₹|\$|€|£)",
        "",
        normalized,
        flags=re.IGNORECASE,
    )

    if "," in normalized and "." in normalized:
        normalized = normalized.replace(",", "")

    elif "," in normalized:
        whole, separator, fraction = normalized.rpartition(",")

        normalized = (
            f"{whole.replace(',', '')}.{fraction}"
            if separator and len(fraction) in (1, 2)
            else normalized.replace(",", "")
        )

    try:
        amount = Decimal(normalized).quantize(Decimal("0.01"))

        return -amount if is_negative else amount

    except InvalidOperation:
        return None


def _amount_on_line(line: str) -> Decimal | None:

    for match in _AMOUNT_PATTERN.finditer(line):

        amount = _parse_amount(match.group(0))

        if amount is not None:
            return amount

    return None


def _find_labeled_amount(
    lines: list[str],
    label_pattern: str
) -> Decimal | None:

    for index, line in enumerate(lines):

        if not re.match(
            rf"^\s*(?:{label_pattern})\b",
            line,
            flags=re.IGNORECASE,
        ):
            continue

        amount = _amount_on_line(line)

        if amount is not None:
            return amount

        for following_line in lines[index + 1:index + 3]:

            amount = _amount_on_line(following_line)

            if amount is not None:
                return amount

    return None


# --------------------------------------------------
# TAX EXTRACTION
# --------------------------------------------------

def _find_tax_amount(lines: list[str]) -> Decimal | None:

    # Prefer an explicit tax total over summing individual tax components.
    total_tax = _find_labeled_amount(
        lines,
        r"(?:total\s+tax|tax\s+total|tax\s+amount)"
    )

    if total_tax is not None:
        return total_tax

    tax_pattern = (
        r"(?:tax(?:\s+amount)?|"
        r"gst(?!in)|vat|sales\s+tax|cgst|sgst|igst)"
    )

    amounts: list[Decimal] = []
    matched_lines: set[int] = set()

    for index, line in enumerate(lines):

        if index in matched_lines or not re.match(
            rf"^\s*(?:{tax_pattern})\b",
            line,
            flags=re.IGNORECASE,
        ):
            continue

        amount = _amount_on_line(line)

        if amount is None:

            for following_index in range(
                index + 1,
                min(index + 3, len(lines))
            ):
                amount = _amount_on_line(lines[following_index])

                if amount is not None:
                    matched_lines.add(following_index)
                    break

        if amount is not None:
            amounts.append(amount)

    return (
        sum(amounts, Decimal("0.00"))
        if amounts
        else None
    )


# --------------------------------------------------
# VENDOR NAME EXTRACTION
# --------------------------------------------------

def _find_vendor_name(lines: list[str]) -> str | None:

    vendor = _find_labeled_value(
        lines,
        r"(?:vendor|supplier|seller|from|billed\s+by)"
    )

    if vendor:
        return vendor[:255]

    excluded_line = re.compile(
        r"invoice|bill\s+to|ship\s+to|gstin|tax\s+id|date|due|"
        r"address|phone|email|www\.|payment\s+terms|description|qty|"
        r"subtotal|total|amount|\b(?:tax|gst|vat)\b",
        re.IGNORECASE,
    )

    for line in lines:

        candidate = line.strip(" \t:-")

        if (
            candidate
            and len(candidate) <= 255
            and re.search(r"[A-Za-z]", candidate)
            and not excluded_line.search(candidate)
            and not re.match(r"^[\d\W]+$", candidate)
        ):
            return candidate

    return None


# --------------------------------------------------
# INVOICE HEADER DATA EXTRACTION
# --------------------------------------------------

def extract_invoice_data(text: str) -> dict[str, Any]:
    """Parse common invoice fields from OCR text; missing fields remain None."""

    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    invoice_number = _find_labeled_value(
        lines,
        r"(?:invoice\s+(?:number|no\.?|#|id)|inv\.?\s+(?:no\.?|#))"
    )

    purchase_order_number = _find_labeled_value(
        lines,
        r"(?:purchase\s+order\s+(?:number|no\.?|#)?|po\s+(?:number|no\.?|#))"
    )

    invoice_date = _parse_date(
        _find_labeled_value(
            lines,
            r"(?:invoice\s+date|date\s+of\s+invoice)"
        )
    )

    due_date = _parse_date(
        _find_labeled_value(
            lines,
            r"(?:due\s+date|payment\s+due|pay\s+by)"
        )
    )

    return {
        "vendor_name": _find_vendor_name(lines),

        "invoice_number": (
            invoice_number[:100]
            if invoice_number
            else None
        ),

        "purchase_order_number": (
            purchase_order_number[:40]
            if purchase_order_number
            else None
        ),

        "invoice_date": invoice_date,

        "due_date": due_date,

        "subtotal_amount": _find_labeled_amount(
            lines,
            r"(?:sub[\s-]?total|net\s+amount|amount\s+before\s+tax)"
        ),

        "tax_amount": _find_tax_amount(lines),

        "total_amount": _find_labeled_amount(
            lines,
            r"(?:grand\s+total|total\s+due|amount\s+due|invoice\s+total|"
            r"balance\s+due|total\s+payable|total\s+amount|total)"
        ),
    }


# --------------------------------------------------
# INVOICE LINE-ITEM EXTRACTION (FIXED VERSION)
# --------------------------------------------------

def extract_invoice_line_items(
    text: str
) -> list[dict[str, Any]]:
    """
    Extract actual invoice product rows from OCR text.

    Supports common formats:
    Description | Quantity | Unit Price | Line Total

    Ignores invoice headers, addresses, dates, GSTIN,
    tax lines, and invoice summary amounts.
    """

    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    items = []

    # Lines containing invoice-level information must never be products.
    ignored_keywords = re.compile(
        r"\b(?:"
        r"invoice|vendor\s+name|supplier|seller|address|gstin|"
        r"invoice\s+date|due\s+date|purchase\s+order|po\s+number|"
        r"bill\s+to|ship\s+to|description|quantity|qty|unit\s+price|"
        r"unitprice|subtotal|sub\s+total|grand\s+total|total\s+due|"
        r"amount\s+due|total\s+amount|invoice\s+total|balance\s+due|"
        r"total\s+payable|payment\s+terms|tax|gst|cgst|sgst|igst|vat"
        r")\b",
        re.IGNORECASE,
    )

    # Numeric tokens, including comma-separated amounts.
    number_pattern = re.compile(
        r"(?<![\w.])"
        r"-?\d[\d,]*(?:\.\d{1,2})?"
        r"(?![\w.])"
    )

    for line in lines:

        # Skip header, tax and summary lines.
        if ignored_keywords.search(line):
            continue

        # Find numbers and their positions in the row.
        matches = list(number_pattern.finditer(line))

        # A typical product row must have at least:
        # quantity, unit price, line total.
        if len(matches) < 3:
            continue

        try:
            # Use the last three numeric values as:
            # Quantity, Unit Price, Line Total.
            quantity_text = matches[-3].group()
            unit_price_text = matches[-2].group()
            line_total_text = matches[-1].group()

            quantity = _parse_amount(quantity_text)
            unit_price = _parse_amount(unit_price_text)
            line_total = _parse_amount(line_total_text)

        except (InvalidOperation, ValueError, TypeError):
            continue

        if quantity is None or unit_price is None or line_total is None:
            continue

        # Validate numeric values.
        if quantity <= 0 or unit_price < 0 or line_total < 0:
            continue

        # The description should be everything before the quantity
        # column, preserving numbers inside the product description.
        description = line[:matches[-3].start()].strip()

        # Remove trailing table separators or punctuation.
        description = description.strip(" \t|:-")

        # Clean repeated spaces.
        description = re.sub(r"\s+", " ", description).strip()

        if not description:
            continue

        # Description must contain actual words.
        if not re.search(r"[A-Za-z]{2,}", description):
            continue

        # Validate quantity x unit price against line total.
        calculated_total = quantity * unit_price

        # Allow small rounding differences.
        if abs(calculated_total - line_total) > Decimal("1.00"):
            continue

        items.append({
            "product_code": "",
            "description": description,
            "quantity": quantity,
            "unit_price": unit_price,
            "line_total": line_total,
            "tax_amount": None,
        })

    return items
