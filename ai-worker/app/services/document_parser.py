"""Document parsing utilities for DOCX and PDF files."""

import io
import logging
from typing import List, Dict
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def parse_docx(file_bytes: bytes) -> List[Dict]:
    """Parse a DOCX file into a list of paragraph dicts."""
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    paragraphs = []
    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if text:
            paragraphs.append({
                "text": text,
                "style": para.style.name if para.style else "Normal",
                "index": i,
            })
    return paragraphs


def parse_pdf(file_bytes: bytes) -> List[Dict]:
    """Parse a PDF file into a list of paragraph dicts using PyMuPDF."""
    import fitz  # pymupdf

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    paragraphs = []
    idx = 0
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text()
        for para in text.split("\n\n"):
            cleaned = para.strip()
            if cleaned and len(cleaned) > 10:  # Skip headers/footers/page numbers
                paragraphs.append({
                    "text": cleaned,
                    "page": page_num + 1,
                    "index": idx,
                })
                idx += 1
    doc.close()
    return paragraphs


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def download_file(url: str) -> bytes:
    """Download a file from URL with retry logic."""
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.content


def normalize_text(text: str) -> str:
    """Normalize text for comparison."""
    import re
    text = re.sub(r'\s+', ' ', text.strip())
    text = text.replace('"', '"').replace('"', '"')
    text = text.replace("'", "'").replace("'", "'")
    text = text.replace('«', '"').replace('»', '"')
    return text
