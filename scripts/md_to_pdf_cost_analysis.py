"""Convert VisionQuest_Annual_Cost_Analysis_2026.md to a formatted PDF."""

import re
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether,
)

# --- Paths ---
MD_PATH = Path(__file__).resolve().parent.parent / "docs" / "VisionQuest_Annual_Cost_Analysis_2026.md"
PDF_PATH = MD_PATH.with_suffix(".pdf")

# --- Colors ---
BLUE = HexColor("#1a56db")
DARK = HexColor("#111827")
GRAY = HexColor("#6b7280")
LIGHT_BG = HexColor("#f9fafb")
WHITE = HexColor("#ffffff")
TABLE_HEADER_BG = HexColor("#1e3a5f")
TABLE_HEADER_FG = HexColor("#ffffff")
TABLE_ALT_BG = HexColor("#f0f4f8")
RED_BG = HexColor("#fef2f2")
RED_BORDER = HexColor("#dc2626")
AMBER_BG = HexColor("#fffbeb")
AMBER_BORDER = HexColor("#d97706")
GREEN_BG = HexColor("#f0fdf4")


# --- Styles ---
styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    "DocTitle", parent=styles["Title"],
    fontSize=22, leading=28, textColor=BLUE, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "Subtitle", parent=styles["Normal"],
    fontSize=10, leading=14, textColor=GRAY, spaceAfter=4,
))
styles.add(ParagraphStyle(
    "H2", parent=styles["Heading2"],
    fontSize=15, leading=20, textColor=BLUE, spaceBefore=18, spaceAfter=8,
    borderWidth=0, borderPadding=0,
))
styles.add(ParagraphStyle(
    "H3", parent=styles["Heading3"],
    fontSize=12, leading=16, textColor=DARK, spaceBefore=14, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "H4", parent=styles["Heading4"],
    fontSize=11, leading=15, textColor=HexColor("#374151"), spaceBefore=10, spaceAfter=4,
))
styles.add(ParagraphStyle(
    "Body", parent=styles["Normal"],
    fontSize=9.5, leading=13.5, textColor=DARK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "BodyBold", parent=styles["Normal"],
    fontSize=9.5, leading=13.5, textColor=DARK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "Blockquote", parent=styles["Normal"],
    fontSize=9, leading=13, textColor=HexColor("#92400e"),
    leftIndent=12, spaceAfter=8,
    backColor=AMBER_BG, borderWidth=0, borderPadding=6,
))
styles.add(ParagraphStyle(
    "FerpaWarning", parent=styles["Normal"],
    fontSize=9, leading=13, textColor=HexColor("#991b1b"),
    leftIndent=12, spaceAfter=8,
    backColor=RED_BG, borderWidth=0, borderPadding=6,
))
styles.add(ParagraphStyle(
    "BulletItem", parent=styles["Normal"],
    fontSize=9.5, leading=13.5, textColor=DARK,
    leftIndent=20, bulletIndent=8, spaceAfter=3,
))
styles.add(ParagraphStyle(
    "TableCell", parent=styles["Normal"],
    fontSize=8.5, leading=11.5, textColor=DARK,
))
styles.add(ParagraphStyle(
    "TableHeader", parent=styles["Normal"],
    fontSize=8.5, leading=11.5, textColor=TABLE_HEADER_FG,
))
styles.add(ParagraphStyle(
    "Footer", parent=styles["Normal"],
    fontSize=7.5, leading=10, textColor=GRAY, alignment=TA_CENTER,
))


def bold_wrap(text: str) -> str:
    """Convert **text** markdown bold to <b>text</b>."""
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)


def inline_format(text: str) -> str:
    """Convert markdown inline formatting to ReportLab XML."""
    t = text
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<i>\1</i>", t)
    t = re.sub(r"`([^`]+)`", r'<font face="Courier" size="8.5">\1</font>', t)
    t = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", t)  # strip links
    return t


def parse_table(lines: list[str]) -> list[list[str]]:
    """Parse markdown table lines into a list of rows (list of cell strings)."""
    rows = []
    for line in lines:
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")]
        cells = cells[1:-1]  # drop empty first/last from leading/trailing |
        if cells and all(set(c.strip()) <= set("-: ") for c in cells):
            continue  # separator row
        rows.append(cells)
    return rows


def build_table_flowable(rows: list[list[str]]) -> Table:
    """Build a styled ReportLab Table from parsed rows."""
    if not rows:
        return Spacer(1, 0)

    header = rows[0]
    data_rows = rows[1:] if len(rows) > 1 else []

    col_count = len(header)
    avail = 6.5 * inch
    col_width = avail / col_count

    # Build cell paragraphs
    table_data = []
    header_cells = [Paragraph(inline_format(c), styles["TableHeader"]) for c in header]
    table_data.append(header_cells)

    for row in data_rows:
        # Pad row if fewer cells
        while len(row) < col_count:
            row.append("")
        table_data.append([Paragraph(inline_format(c), styles["TableCell"]) for c in row[:col_count]])

    t = Table(table_data, colWidths=[col_width] * col_count, repeatRows=1)

    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), TABLE_HEADER_FG),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]

    # Alternate row shading
    for i in range(1, len(table_data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), TABLE_ALT_BG))

    t.setStyle(TableStyle(style_cmds))
    return t


def convert(md_path: Path, pdf_path: Path):
    lines = md_path.read_text(encoding="utf-8").splitlines()

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title="VisionQuest Annual Cost Analysis 2026",
        author="VisionQuest Project",
    )

    story: list = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines
        if not stripped:
            i += 1
            continue

        # Horizontal rule
        if stripped == "---":
            story.append(Spacer(1, 6))
            story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#e5e7eb")))
            story.append(Spacer(1, 6))
            i += 1
            continue

        # H1
        if stripped.startswith("# ") and not stripped.startswith("## "):
            text = inline_format(stripped[2:])
            story.append(Paragraph(text, styles["DocTitle"]))
            i += 1
            continue

        # H2
        if stripped.startswith("## "):
            text = inline_format(stripped[3:])
            story.append(Spacer(1, 4))
            story.append(Paragraph(text, styles["H2"]))
            i += 1
            continue

        # H3
        if stripped.startswith("### "):
            text = inline_format(stripped[4:])
            story.append(Paragraph(text, styles["H3"]))
            i += 1
            continue

        # H4
        if stripped.startswith("#### "):
            text = inline_format(stripped[5:])
            story.append(Paragraph(text, styles["H4"]))
            i += 1
            continue

        # Table — collect all consecutive table lines
        if stripped.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = parse_table(table_lines)
            if rows:
                story.append(Spacer(1, 4))
                story.append(build_table_flowable(rows))
                story.append(Spacer(1, 6))
            continue

        # Blockquote
        if stripped.startswith("> "):
            quote_text = stripped[2:]
            # Collect multi-line blockquotes
            while i + 1 < len(lines) and lines[i + 1].strip().startswith("> "):
                i += 1
                quote_text += " " + lines[i].strip()[2:]

            formatted = inline_format(quote_text)
            # Use FERPA warning style for FERPA/BLOCKED content
            if "FERPA" in quote_text or "BLOCKED" in quote_text:
                style = styles["FerpaWarning"]
            else:
                style = styles["Blockquote"]
            story.append(Paragraph(formatted, style))
            i += 1
            continue

        # Bullet points
        if stripped.startswith("- "):
            text = inline_format(stripped[2:])
            story.append(Paragraph(text, styles["BulletItem"], bulletText="\u2022"))
            i += 1
            continue

        # Numbered list
        m = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if m:
            num = m.group(1)
            text = inline_format(m.group(2))
            story.append(Paragraph(text, styles["BulletItem"], bulletText=f"{num}."))
            i += 1
            continue

        # Regular paragraph
        para_text = stripped
        # Collect continuation lines (not empty, not heading, not table, not list, not hr)
        while (i + 1 < len(lines)
               and lines[i + 1].strip()
               and not lines[i + 1].strip().startswith(("#", "|", "-", ">", "---"))
               and not re.match(r"^\d+\.", lines[i + 1].strip())):
            i += 1
            para_text += " " + lines[i].strip()

        formatted = inline_format(para_text)
        story.append(Paragraph(formatted, styles["Body"]))
        i += 1

    # Footer
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#e5e7eb")))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "VisionQuest Annual Cost Analysis | Prepared April 6, 2026 | Confidential",
        styles["Footer"],
    ))

    doc.build(story)
    print(f"PDF created: {pdf_path}")


if __name__ == "__main__":
    convert(MD_PATH, PDF_PATH)
