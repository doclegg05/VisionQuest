import FormFillClient from "./FormFillClient";

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default async function StudentFormFillPage({ params }: PageProps) {
  const { templateId } = await params;
  return <FormFillClient templateId={templateId} />;
}
