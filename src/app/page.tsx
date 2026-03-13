import AuthPageClient from "@/components/auth/AuthPageClient";

export default function AuthPage() {
  const googleAuthEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  );

  return <AuthPageClient googleAuthEnabled={googleAuthEnabled} />;
}
