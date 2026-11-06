import BrandLockup from "@/components/ui/BrandLockup";
import { AcceptInviteForm } from "@/components/staff/AcceptInviteForm";
import { previewStaffInvite } from "@/lib/staff-invite-list";
import { STAFF_INVITE_MESSAGES, STAFF_ROLE_LABELS } from "@/lib/staff-invite-messages";

export const dynamic = "force-dynamic";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invite = await previewStaffInvite(token);

  return (
    <main className="page-shell mx-auto max-w-md space-y-6 py-10">
      <BrandLockup />
      {invite ? (
        <>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ink-strong)]">Join VisionQuest</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              You are invited as {STAFF_ROLE_LABELS[invite.role] ?? invite.role}
              {invite.regionName ? ` for ${invite.regionName}` : ""}.
            </p>
          </div>
          <AcceptInviteForm token={token} email={invite.email} />
        </>
      ) : (
        <div role="alert">
          <h1 className="text-2xl font-bold text-[var(--ink-strong)]">This invite cannot be used</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">{STAFF_INVITE_MESSAGES.invalid}</p>
        </div>
      )}
    </main>
  );
}
