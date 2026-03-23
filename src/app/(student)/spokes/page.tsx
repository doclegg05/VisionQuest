import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function SpokesPage() {
  const session = await getSession();
  if (!session) return null;
  redirect("/dashboard");
}
