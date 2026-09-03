import { NextResponse } from "next/server";
import { signToken } from "@/lib/session-token";
import { cookies } from "next/headers";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed in production" }, { status: 403 });
  }
  const token = signToken("cmmyy9e5x0007gj3h97et3t29", "admin", 0);
  const cookieStore = await cookies();
  cookieStore.set("vq-session", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
  });
  return NextResponse.redirect("http://localhost:3000/teacher");
}
