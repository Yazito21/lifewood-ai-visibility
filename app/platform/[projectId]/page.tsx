import { redirect } from "next/navigation";

export default async function ProjectHomePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/platform/${projectId}/dashboard`);
}
