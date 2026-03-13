import CertTracker from "@/components/certifications/CertTracker";
import CredentialSharePanel from "@/components/certifications/CredentialSharePanel";
import PageIntro from "@/components/ui/PageIntro";

export default function CertificationsPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Credentials"
        title="Certifications"
        description="Track your progress toward the SPOKES Ready to Work Certification."
      />
      <CertTracker />
      <div className="mt-4">
        <CredentialSharePanel />
      </div>
    </div>
  );
}
