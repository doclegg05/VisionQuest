import CertTracker from "@/components/certifications/CertTracker";
import CredentialSharePanel from "@/components/certifications/CredentialSharePanel";
import CredlyBadges from "@/components/certifications/CredlyBadges";
import PageIntro from "@/components/ui/PageIntro";

export default function CertificationsPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Credentials"
        title="Certifications"
        description="Track your progress toward the SPOKES Ready to Work Certification."
      />
      <CredlyBadges />
      <div className="mt-4">
        <CertTracker />
      </div>
      <div className="mt-4">
        <CredentialSharePanel />
      </div>
    </div>
  );
}
