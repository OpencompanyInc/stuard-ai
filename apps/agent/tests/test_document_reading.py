import asyncio
import shutil
import zipfile
from contextlib import contextmanager
from pathlib import Path

from app.tools import fs as fs_tools


@contextmanager
def _fixture_dir(name: str):
    base_dir = Path(__file__).resolve().parents[3] / "scratch-test" / "document-read-tests" / name
    if base_dir.exists():
        shutil.rmtree(base_dir, ignore_errors=True)
    base_dir.mkdir(parents=True, exist_ok=True)
    try:
        yield base_dir
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)


def _write_minimal_pdf(path: Path) -> None:
    pdf_bytes = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 67 >>
stream
BT
/F1 18 Tf
72 100 Td
(Hello PDF) Tj
0 -24 Td
(Second line) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000062 00000 n 
0000000119 00000 n 
0000000245 00000 n 
0000000362 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
432
%%EOF
"""
    path.write_bytes(pdf_bytes)


def _write_minimal_xlsx(path: Path) -> None:
    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Budget" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"""
    workbook_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
                Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
                Target="worksheets/sheet1.xml"/>
</Relationships>
"""
    shared_strings_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Item</t></si>
  <si><t>Amount</t></si>
  <si><t>Rent</t></si>
  <si><t>1200</t></si>
</sst>
"""
    sheet_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="s"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>
"""

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
      zf.writestr("xl/workbook.xml", workbook_xml)
      zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
      zf.writestr("xl/sharedStrings.xml", shared_strings_xml)
      zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def test_read_file_extracts_pdf_text():
    with _fixture_dir("pdf") as fixture_dir:
        target = fixture_dir / "sample.pdf"
        _write_minimal_pdf(target)

        result = asyncio.run(fs_tools.read_file({"path": str(target)}))

        assert result["ok"] is True
        assert result["document_type"] == "pdf"
        assert result["mime_type"] == "application/pdf"
        assert "Hello PDF" in result["content"]
        assert "Second line" in result["content"]


def test_read_file_extracts_xlsx_text():
    with _fixture_dir("xlsx") as fixture_dir:
        target = fixture_dir / "budget.xlsx"
        _write_minimal_xlsx(target)

        result = asyncio.run(fs_tools.read_file({"path": str(target)}))

        assert result["ok"] is True
        assert result["document_type"] == "spreadsheet"
        assert "Budget" in result["sheet_names"]
        assert "[Sheet: Budget]" in result["content"]
        assert "Item\tAmount" in result["content"]
        assert "Rent\t1200" in result["content"]


def test_file_read_numbers_extracted_spreadsheet_lines():
    with _fixture_dir("file-read") as fixture_dir:
        target = fixture_dir / "budget.xlsx"
        _write_minimal_xlsx(target)

        result = asyncio.run(fs_tools.file_read({"path": str(target), "whole_file": True}))

        assert result["ok"] is True
        assert result["document_type"] == "spreadsheet"
        assert "[Sheet: Budget]" in result["content"]
        assert "Item\tAmount" in result["content"]
        assert "Rent\t1200" in result["content"]
        assert result["lines_returned"] >= 3
