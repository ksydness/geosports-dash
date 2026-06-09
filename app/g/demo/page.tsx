import Dashboard from '../[group_code]/dashboard';
import { generateDemoData, DEMO_GROUP_NAME, DEMO_GUESSES, DEMO_QUESTIONS } from '@/lib/demo-data';

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
        demoGuesses: DEMO_GUESSES,
        demoQuestions: DEMO_QUESTIONS,
      }}
    />
  );
}
