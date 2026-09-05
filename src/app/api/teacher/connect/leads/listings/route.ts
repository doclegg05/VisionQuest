import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { listManagedClasses } from "@/lib/classroom";
import { listConvertibleListings } from "@/lib/connect/leads";

/**
 * The open job postings on one class's board that could become leads
 * (UX review WARNING #3).
 *
 * The "Add lead" form used to ask an instructor to paste a posting ID — a
 * string they had no way to see, from a page they would have had to leave.
 * This feeds a picker instead: titles and companies to choose from, with the
 * id kept in the option value where a person never has to touch it.
 *
 * Postings that are ALREADY leads are filtered out in the lib, so the picker
 * only ever offers choices that do something.
 *
 * No student data is read here at all — a JobListing is a scraped third-party
 * posting — so there is no `recordStudentView`.
 */

const querySchema = z.object({ classId: z.string().cuid("Pick a class.") });

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ classId: url.searchParams.get("classId") ?? "" });
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Pick a class.");
  }

  const managed = await listManagedClasses(session, { includeArchived: true });
  const spokesClass = managed.find((row) => row.id === parsed.data.classId);
  if (!spokesClass) throw notFound("That class wasn't found.");

  const listings = await listConvertibleListings(spokesClass.id);
  return NextResponse.json({ listings });
});
