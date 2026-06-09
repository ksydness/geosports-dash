import Dashboard from './dashboard';

export default async function GroupPage({
  params,
}: {
  params: Promise<{ group_code: string }>;
}) {
  const { group_code } = await params;
  return <Dashboard groupCode={group_code.toUpperCase()} />;
}
