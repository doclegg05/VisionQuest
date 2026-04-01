"""Generate VisionQuest Regional Rollout Cost Report PDF."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether,
)

# Colors
NAVY = HexColor("#0f1f3d")
GREEN = HexColor("#37b550")
GOLD = HexColor("#d3b257")
LIGHT_BG = HexColor("#f4f6f9")
DARK_TEXT = HexColor("#1a1a2e")
MUTED = HexColor("#6b7280")
WHITE = white
BORDER = HexColor("#d1d5db")
ROW_ALT = HexColor("#f9fafb")
HEADER_BG = HexColor("#1e3a5f")

OUTPUT_PATH = "docs/VisionQuest_Regional_Rollout_Report.pdf"


def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        "CoverTitle", parent=styles["Title"],
        fontSize=28, leading=34, textColor=NAVY,
        spaceAfter=6, alignment=TA_CENTER, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "CoverSubtitle", parent=styles["Normal"],
        fontSize=14, leading=18, textColor=MUTED,
        spaceAfter=4, alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        "SectionHead", parent=styles["Heading1"],
        fontSize=16, leading=20, textColor=NAVY,
        spaceBefore=20, spaceAfter=8, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "SubHead", parent=styles["Heading2"],
        fontSize=12, leading=16, textColor=DARK_TEXT,
        spaceBefore=12, spaceAfter=6, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=10, leading=14, textColor=DARK_TEXT,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        "BodyBold", parent=styles["Normal"],
        fontSize=10, leading=14, textColor=DARK_TEXT,
        spaceAfter=6, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "Callout", parent=styles["Normal"],
        fontSize=11, leading=15, textColor=NAVY,
        spaceAfter=8, fontName="Helvetica-BoldOblique",
        leftIndent=12, rightIndent=12,
    ))
    styles.add(ParagraphStyle(
        "FooterStyle", parent=styles["Normal"],
        fontSize=8, textColor=MUTED, alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        "TableCell", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=DARK_TEXT,
    ))
    styles.add(ParagraphStyle(
        "TableCellBold", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=DARK_TEXT, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "TableHeader", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=WHITE, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "TableCellRight", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=DARK_TEXT, alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        "TableCellRightBold", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=DARK_TEXT,
        fontName="Helvetica-Bold", alignment=TA_RIGHT,
    ))
    return styles


def make_table(headers, rows, col_widths=None, bold_last_row=False):
    """Build a styled table with header row and alternating row colors."""
    s = build_styles()
    data = [[Paragraph(h, s["TableHeader"]) for h in headers]]
    for i, row in enumerate(rows):
        is_bold = bold_last_row and i == len(rows) - 1
        styled_row = []
        for j, cell in enumerate(row):
            if is_bold:
                st = s["TableCellRightBold"] if j >= 1 else s["TableCellBold"]
            else:
                st = s["TableCellRight"] if j >= 1 else s["TableCell"]
            styled_row.append(Paragraph(str(cell), st))
        data.append(styled_row)

    if not col_widths:
        col_widths = [None] * len(headers)

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
    # Alternate row backgrounds
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))

    if bold_last_row:
        style_cmds.append(("BACKGROUND", (0, len(data) - 1), (-1, len(data) - 1), HexColor("#e8f5e9")))
        style_cmds.append(("FONTNAME", (0, len(data) - 1), (-1, len(data) - 1), "Helvetica-Bold"))

    t.setStyle(TableStyle(style_cmds))
    return t


def add_footer(canvas_obj, doc):
    canvas_obj.saveState()
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.setFillColor(MUTED)
    canvas_obj.drawCentredString(
        letter[0] / 2, 0.5 * inch,
        f"VisionQuest Regional Rollout Report  |  Prepared April 2026  |  Page {doc.page}"
    )
    canvas_obj.restoreState()


def build_report():
    s = build_styles()
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        topMargin=0.75 * inch,
        bottomMargin=0.85 * inch,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
    )
    story = []

    # ── Cover ──
    story.append(Spacer(1, 1.5 * inch))
    story.append(Paragraph("VisionQuest", s["CoverTitle"]))
    story.append(Paragraph("Regional Rollout Proposal", s["CoverSubtitle"]))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="40%", thickness=2, color=GREEN, spaceAfter=12, hAlign="CENTER"))
    story.append(Spacer(1, 12))
    story.append(Paragraph("Scaling from 1 Classroom to 11 Classrooms", s["CoverSubtitle"]))
    story.append(Paragraph("Cost Analysis &amp; Infrastructure Readiness", s["CoverSubtitle"]))
    story.append(Spacer(1, 24))
    story.append(Paragraph("Prepared: April 1, 2026", s["CoverSubtitle"]))
    story.append(Paragraph("Target Launch: June 30, 2026", s["CoverSubtitle"]))
    story.append(PageBreak())

    # ── Executive Summary ──
    story.append(Paragraph("Executive Summary", s["SectionHead"]))
    story.append(Paragraph(
        "VisionQuest is an AI-coach-driven workforce development portal currently serving one "
        "SPOKES classroom of approximately 20 students. The regional director has requested "
        "expansion to all 11 classrooms in the region (~200 students) by end of June 2026.",
        s["Body"],
    ))
    story.append(Paragraph(
        "This report details the infrastructure upgrades, subscription costs, new features, "
        "and business arrangements needed to support the rollout. All costs are based on "
        "current published pricing as of April 2026.",
        s["Body"],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Total estimated annual cost: $1,700 - $3,100/year ($140 - $260/month) "
        "depending on AI usage volume and optional SMS notifications.",
        s["Callout"],
    ))
    story.append(Spacer(1, 6))

    # ── Section 1: Current vs Required ──
    story.append(Paragraph("1. Current Stack vs. Required Changes", s["SectionHead"]))
    story.append(make_table(
        ["Service", "Current (1 Class)", "Required (11 Classes)", "Action"],
        [
            ["Render (hosting)", "Starter $7/mo", "Standard $25/mo", "Upgrade"],
            ["Supabase (DB + storage)", "Free tier", "Pro $25/mo", "Upgrade"],
            ["Gemini API (Sage AI)", "Free tier", "Pay-as-you-go", "Upgrade"],
            ["Sentry (error tracking)", "Free", "Free", "None"],
            ["Email / SMTP", "Nodemailer + SMTP", "Resend (free tier)", "Swap provider"],
            ["Twilio SMS", "Not active", "Optional ~$12/mo", "Optional"],
            ["Google OAuth", "Free", "Free", "None"],
            ["Custom domain", "onrender.com", "Custom .com", "Purchase ($12/yr)"],
        ],
        col_widths=[1.6 * inch, 1.5 * inch, 1.7 * inch, 1.5 * inch],
    ))
    story.append(Spacer(1, 6))

    # ── Section 2: Monthly Operating Costs ──
    story.append(Paragraph("2. Monthly &amp; Annual Operating Costs", s["SectionHead"]))
    story.append(Paragraph(
        "The following table breaks down recurring costs at full scale (200 students across "
        "11 classrooms). Ranges reflect usage variability and optional optimizations.",
        s["Body"],
    ))
    story.append(make_table(
        ["Line Item", "Monthly", "Annual", "Notes"],
        [
            ["Render (Standard + 3 crons)", "$28 - $56", "$336 - $672",
             "$25 web + $3-6 crons; up to $50 with autoscale"],
            ["Supabase Pro", "$25", "$300",
             "8 GB database, 100 GB storage"],
            ["Gemini API (Flash Lite)", "$85 - $160", "$1,020 - $1,920",
             "With context caching: $85-115/mo"],
            ["Sentry", "$0", "$0", "Free tier sufficient"],
            ["Resend (email)", "$0", "$0", "Free tier: 3,000 emails/mo"],
            ["Twilio SMS (optional)", "$8 - $17", "$96 - $204",
             "Appointment reminders only"],
            ["Custom domain", "--", "$12", "Cloudflare Registrar; SSL free"],
            ["TOTAL (without SMS)", "$138 - $241", "$1,668 - $2,904", ""],
            ["TOTAL (with SMS)", "$146 - $258", "$1,764 - $3,108", ""],
        ],
        col_widths=[1.7 * inch, 1.0 * inch, 1.2 * inch, 2.4 * inch],
        bold_last_row=True,
    ))
    story.append(Spacer(1, 6))

    # Cost optimization callout
    story.append(Paragraph("Cost Optimization Opportunity", s["SubHead"]))
    story.append(Paragraph(
        "Implementing <b>context caching</b> on Sage's system instruction (the ~2,000-token "
        "prompt that repeats on every API call) would reduce Gemini costs by 15-25%, bringing "
        "the best-case monthly total to approximately <b>$139/month ($1,668/year)</b>. "
        "This is a code change, not a subscription change, and can be done before rollout.",
        s["Body"],
    ))
    story.append(Spacer(1, 6))

    # ── Section 3: Annual Billing ──
    story.append(Paragraph("3. Annual vs. Monthly Billing Analysis", s["SectionHead"]))
    story.append(Paragraph(
        "The regional director expressed interest in annual subscriptions for cost stability. "
        "Here is the availability by service:",
        s["Body"],
    ))
    story.append(make_table(
        ["Service", "Annual Billing?", "Discount", "Recommendation"],
        [
            ["Render", "Yes", "Up to 20%", "Take it (saves ~$50-60/yr)"],
            ["Supabase", "No (self-serve)", "None at Pro tier", "Pay monthly $25"],
            ["Gemini API", "No", "Usage-based only", "Pay as you go"],
            ["Sentry", "Yes (Team plan)", "~20%", "Not needed; free tier is sufficient"],
            ["Twilio", "No", "Enterprise only", "Too small for annual commitment"],
            ["Resend", "N/A", "Free tier", "No cost"],
            ["Domain", "Yes", "Billed annually", "Standard annual registration"],
        ],
        col_widths=[1.3 * inch, 1.2 * inch, 1.3 * inch, 2.5 * inch],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Only Render and the domain support annual prepay. Cloud APIs (Gemini, Twilio) are "
        "usage-based across the industry. This is not unique to our stack -- alternatives "
        "(OpenAI, Anthropic, AWS) have the same billing model. No alternative provider changes this.",
        s["Body"],
    ))

    story.append(PageBreak())

    # ── Section 4: Gemini Comparison ──
    story.append(Paragraph("4. AI Model Cost Comparison", s["SectionHead"]))
    story.append(Paragraph(
        "Sage currently uses Google Gemini 2.5 Flash Lite. Here is how it compares to "
        "alternatives at our projected volume (~192 students, 80 calls/day, 20 school days/month):",
        s["Body"],
    ))
    story.append(make_table(
        ["Model", "Input $/1M tok", "Output $/1M tok", "Est. Monthly (192 students)", "Notes"],
        [
            ["Gemini 2.5 Flash Lite", "$0.10", "$0.40", "~$140", "Current. Cheapest."],
            ["GPT-4o-mini", "$0.15", "$0.60", "~$200", "43% more; strong quality"],
            ["Gemini 2.5 Flash", "$0.30", "$2.50", "~$555", "Better reasoning; 4x cost"],
            ["Claude Haiku 3.5", "$0.80", "$4.00", "~$650", "Best quality in budget tier"],
        ],
        col_widths=[1.4 * inch, 0.9 * inch, 1.0 * inch, 1.5 * inch, 1.5 * inch],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Recommendation:</b> Stay on Gemini 2.5 Flash Lite. If coaching quality "
        "becomes a concern, the upgrade path is: Flash Lite -> GPT-4o-mini (~$200/mo) -> "
        "Gemini Flash (~$555/mo) -> Claude Haiku (~$650/mo).",
        s["Body"],
    ))
    story.append(Spacer(1, 6))

    # ── Section 5: Infrastructure Changes ──
    story.append(Paragraph("5. Infrastructure Changes Before Rollout", s["SectionHead"]))
    changes = [
        ("<b>Render:</b> Upgrade from Starter ($7/mo) to Standard ($25/mo); "
         "enable autoscaling (max 2 instances for reliability)."),
        ("<b>Supabase:</b> Upgrade from Free to Pro ($25/mo) for production backups, "
         "8 GB database, and 100 GB file storage."),
        ("<b>Gemini API:</b> Implement context caching on Sage's system instruction "
         "to reduce token costs by 15-25%."),
        ("<b>Email:</b> Switch from raw SMTP/nodemailer to Resend for better "
         "deliverability and free tier (3,000 emails/month)."),
        ("<b>Domain:</b> Register a custom .com domain (~$12/year), point DNS to Render. "
         "SSL is automatically provisioned at no cost."),
        ("<b>Multi-tenancy:</b> Ensure teacher/classroom isolation so each of the 11 "
         "teachers manages only their own students."),
    ]
    for item in changes:
        story.append(Paragraph(f"&bull;  {item}", s["Body"]))
    story.append(Spacer(1, 6))

    # ── Section 6: New Features ──
    story.append(Paragraph("6. Features Needed for Multi-Classroom Deployment", s["SectionHead"]))
    story.append(make_table(
        ["Feature", "Purpose", "Effort"],
        [
            ["Regional admin dashboard",
             "Gives the regional director visibility across all 11 classrooms",
             "Medium"],
            ["Teacher onboarding flow",
             "Self-serve registration for each classroom teacher",
             "Small"],
            ["Per-classroom data isolation",
             "Teachers see only their own students (partially exists)",
             "Small"],
            ["Bulk student import (CSV)",
             "Onboard ~200 students efficiently (CSV utility added)",
             "Small"],
            ["Per-classroom rate limiting",
             "Prevent one class from consuming disproportionate AI budget",
             "Small"],
        ],
        col_widths=[1.8 * inch, 3.0 * inch, 1.0 * inch],
    ))

    story.append(PageBreak())

    # ── Section 7: Business Entity ──
    story.append(Paragraph("7. Business Entity &amp; Billing Options", s["SectionHead"]))
    story.append(Paragraph(
        "If the regional office pays the instructor directly for VisionQuest subscriptions, "
        "a simple business entity is needed. West Virginia offers low-cost options:",
        s["Body"],
    ))
    story.append(make_table(
        ["Path", "Setup Cost", "Annual Cost", "Liability Protection"],
        [
            ["Sole Proprietor + DBA", "$55", "$25/yr renewal", "None"],
            ["WV LLC (recommended)", "$130", "$25/yr renewal", "Yes"],
            ["+ E&amp;O Insurance", "+$500-$900/yr", "Same", "Professional liability"],
        ],
        col_widths=[1.8 * inch, 1.2 * inch, 1.3 * inch, 1.8 * inch],
    ))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Billing Workflow", s["SubHead"]))
    billing_steps = [
        "Form a WV LLC ($130 one-time filing, $25/year renewal).",
        "Register as a vendor with the regional workforce office (W-9 + vendor number).",
        "Invoice the region monthly or annually via Stripe ACH ($5 cap per payment).",
        "The region issues a purchase order; you invoice against it; they pay.",
        "Budget for 15.3% self-employment tax + quarterly estimated payments.",
        "One CPA session ($150-$300) to set up your books and tax schedule.",
    ]
    for i, step in enumerate(billing_steps, 1):
        story.append(Paragraph(f"{i}.  {step}", s["Body"]))
    story.append(Spacer(1, 6))

    # ── Section 8: Education Discounts ──
    story.append(Paragraph("8. Education &amp; Nonprofit Discount Programs", s["SectionHead"]))
    story.append(Paragraph(
        "If VisionQuest is operated under or in partnership with a government agency or "
        "501(c)(3) nonprofit, the following programs may offset costs:",
        s["Body"],
    ))
    story.append(make_table(
        ["Program", "Benefit", "Eligibility"],
        [
            ["Google for Nonprofits", "$1,000/yr in Cloud credits",
             "501(c)(3) or government agency"],
            ["Microsoft for Nonprofits", "Free M365 + $3,500 Azure credits",
             "501(c)(3) or government agency"],
            ["TechSoup", "Deep discounts on many tools",
             "501(c)(3) or government agency"],
            ["GitHub for Education", "Free GitHub Team plan",
             "Verified educator"],
        ],
        col_widths=[1.8 * inch, 2.2 * inch, 2.3 * inch],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Key insight:</b> The regional workforce program office likely qualifies for these "
        "discounts even if an individual educator does not. The $1,000 Google for Nonprofits "
        "credit alone could cover 6-12 months of Gemini API costs.",
        s["Body"],
    ))

    story.append(PageBreak())

    # ── Section 9: Total First-Year Cost ──
    story.append(Paragraph("9. Total First-Year Investment Summary", s["SectionHead"]))
    story.append(make_table(
        ["Category", "Low Estimate", "High Estimate", "Notes"],
        [
            ["Infrastructure (annual)", "$1,668", "$3,108", "Hosting + DB + AI + optional SMS"],
            ["LLC formation", "$130", "$130", "One-time filing"],
            ["Business registration", "$30", "$30", "One-time"],
            ["CPA consultation", "$150", "$300", "One-time setup"],
            ["E&amp;O Insurance (optional)", "$0", "$900", "Recommended for gov contracts"],
            ["Custom domain", "$12", "$12", "Annual"],
            ["", "", "", ""],
            ["TOTAL FIRST YEAR", "$1,990", "$4,480", ""],
        ],
        col_widths=[2.0 * inch, 1.2 * inch, 1.2 * inch, 1.9 * inch],
        bold_last_row=True,
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Subsequent years (infrastructure + LLC renewal + insurance + domain) "
        "would cost approximately <b>$1,700 - $4,000/year</b> depending on options selected.",
        s["Body"],
    ))
    story.append(Spacer(1, 16))

    # ── Recommendation Box ──
    story.append(HRFlowable(width="100%", thickness=1, color=GREEN, spaceAfter=12))
    story.append(Paragraph("Recommendation", s["SectionHead"]))
    story.append(Paragraph(
        "VisionQuest can scale from 1 to 11 classrooms for under <b>$260/month</b> "
        "in operating costs with no architectural redesign required. The platform already "
        "supports multi-teacher isolation, has CSV import capabilities, and runs on a "
        "modern, horizontally scalable stack.",
        s["Body"],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "The recommended path forward:", s["BodyBold"],
    ))
    recs = [
        "Upgrade Render and Supabase to paid tiers (combined $50/month).",
        "Implement Gemini context caching to minimize AI costs.",
        "Form a WV LLC and establish vendor billing with the region.",
        "Build a regional admin dashboard for cross-classroom visibility.",
        "Target rollout by June 30, 2026 with a phased onboarding (3-4 classrooms per wave).",
    ]
    for i, rec in enumerate(recs, 1):
        story.append(Paragraph(f"{i}.  {rec}", s["Body"]))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=1, color=GREEN, spaceAfter=12))

    # Build the PDF
    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    print(f"Report generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_report()
