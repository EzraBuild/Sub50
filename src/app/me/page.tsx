import type { Metadata } from 'next';
import { ActivityShell } from '../../components/activity/ActivityShell';

export const metadata: Metadata = {
  title: 'Your activity — Sub50',
  description: 'Rooms you listened in, who with, the songs and the chat.',
};

export default function Page() {
  return <ActivityShell />;
}
