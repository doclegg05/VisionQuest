import jsPDF from "jspdf";

export interface CertificateData {
  studentName: string;
  certificateType: string; // e.g. "Certificate of Achievement", "Ready to Work"
  dateEarned: string; // ISO date string
  programName?: string; // defaults to "SPOKES Workforce Development Program"
}

export async function generateCertificatePDF(
  data: CertificateData
): Promise<Blob> {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const programName =
    data.programName || "SPOKES Workforce Development Program";

  // Colors (from VisionQuest design system)
  const navy = [16, 37, 62]; // #10253e
  const orange = [249, 115, 22]; // #f97316
  const teal = [15, 154, 146]; // #0f9a92
  const cream = [245, 236, 220]; // #f5ecdc

  // Background
  doc.setFillColor(cream[0], cream[1], cream[2]);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Decorative border (double line)
  doc.setDrawColor(navy[0], navy[1], navy[2]);
  doc.setLineWidth(1.5);
  doc.rect(10, 8, pageWidth - 20, pageHeight - 16);
  doc.setLineWidth(0.5);
  doc.rect(14, 12, pageWidth - 28, pageHeight - 24);

  // Corner accents (small teal squares)
  doc.setFillColor(teal[0], teal[1], teal[2]);
  const cornerSize = 4;
  doc.rect(10, 8, cornerSize, cornerSize, "F");
  doc.rect(pageWidth - 10 - cornerSize, 8, cornerSize, cornerSize, "F");
  doc.rect(10, pageHeight - 8 - cornerSize, cornerSize, cornerSize, "F");
  doc.rect(
    pageWidth - 10 - cornerSize,
    pageHeight - 8 - cornerSize,
    cornerSize,
    cornerSize,
    "F"
  );

  // Try to load logo
  try {
    const logoResponse = await fetch("/spokes-logo.png");
    if (logoResponse.ok) {
      const logoBlob = await logoResponse.blob();
      const logoBase64 = await blobToBase64(logoBlob);
      doc.addImage(logoBase64, "PNG", pageWidth / 2 - 20, 20, 40, 26);
    }
  } catch {
    // Continue without logo
  }

  let yPos = 55;

  // "Certificate of" label
  doc.setFont("times", "normal");
  doc.setFontSize(14);
  doc.setTextColor(teal[0], teal[1], teal[2]);
  doc.text("CERTIFICATE OF", pageWidth / 2, yPos, { align: "center" });
  yPos += 12;

  // Certificate type
  doc.setFont("times", "bold");
  doc.setFontSize(32);
  doc.setTextColor(navy[0], navy[1], navy[2]);
  doc.text(data.certificateType.toUpperCase(), pageWidth / 2, yPos, {
    align: "center",
  });
  yPos += 14;

  // Decorative line
  doc.setDrawColor(orange[0], orange[1], orange[2]);
  doc.setLineWidth(0.8);
  doc.line(pageWidth / 2 - 50, yPos, pageWidth / 2 + 50, yPos);
  yPos += 12;

  // "This certifies that"
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text("This certifies that", pageWidth / 2, yPos, { align: "center" });
  yPos += 12;

  // Student name
  doc.setFont("times", "bold");
  doc.setFontSize(28);
  doc.setTextColor(navy[0], navy[1], navy[2]);
  doc.text(data.studentName, pageWidth / 2, yPos, { align: "center" });
  yPos += 10;

  // Name underline
  const nameWidth = doc.getTextWidth(data.studentName);
  doc.setDrawColor(teal[0], teal[1], teal[2]);
  doc.setLineWidth(0.3);
  doc.line(
    pageWidth / 2 - nameWidth / 2 - 5,
    yPos,
    pageWidth / 2 + nameWidth / 2 + 5,
    yPos
  );
  yPos += 10;

  // "has successfully completed the requirements"
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(
    "has successfully completed the requirements for the",
    pageWidth / 2,
    yPos,
    { align: "center" }
  );
  yPos += 8;

  // Program name
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.setTextColor(navy[0], navy[1], navy[2]);
  doc.text(programName, pageWidth / 2, yPos, { align: "center" });
  yPos += 14;

  // Date
  const formattedDate = new Date(data.dateEarned).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.text(`Awarded on ${formattedDate}`, pageWidth / 2, yPos, {
    align: "center",
  });
  yPos += 16;

  // Signature line
  doc.setDrawColor(navy[0], navy[1], navy[2]);
  doc.setLineWidth(0.3);
  doc.line(pageWidth / 2 - 40, yPos, pageWidth / 2 + 40, yPos);
  yPos += 5;
  doc.setFontSize(9);
  doc.text("Program Administrator", pageWidth / 2, yPos, { align: "center" });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(
    "West Virginia Adult Education \u2022 SPOKES Program \u2022 VisionQuest",
    pageWidth / 2,
    pageHeight - 14,
    { align: "center" }
  );

  return doc.output("blob");
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
