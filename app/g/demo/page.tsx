import Dashboard from '../[group_code]/dashboard';
import { generateDemoData, DEMO_GROUP_NAME } from '@/lib/demo-data';

export const metadata = {
  title: 'Demo — GeoSports Dash',
};

export default function DemoPage() {
  const scores = generateDemoData();

  return (
    <Dashboard
      groupCode="demo"
      initialData={{
        group_name: DEMO_GROUP_NAME,
        scores,
        active: true,
      }}
    />
  );
}
