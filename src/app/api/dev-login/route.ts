import { NextResponse } from "next/server";

// Retired authentication bypass. Never query accounts or issue sessions here,
// including in development/test; E2E uses the real /api/auth/login endpoint.
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
