import type { Metadata } from 'next';
import { ActivityShell } from '../../components/activity/ActivityShell';
import { searchAccess } from '../../server/viewer';

export const metadata: Metadata = {
  title: 'Your activity — Sub50',
  description: 'Rooms you listened in, who with, the songs and the chat.',
};

export default async function Page() {
  // Adding songs to a playlist by name uses search (a YouTube key, and the pass while invite-only).
  return <ActivityShell {...await searchAccess()} />;
}
