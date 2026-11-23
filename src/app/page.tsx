import { redirect } from 'next/navigation';
import { ClientShell } from '../components/ClientShell';
import { PrivateGate } from '../components/access/PrivateGate';
import { roomAccess } from '../server/viewer';
import { newRoomId, parseRoomId } from '../shared/room';

interface Props {
  searchParams: Promise<{ room?: string | string[] }>;
}

/** Rooms live in `?room=`. A visit without one gets a fresh room before any JS runs. */
export default async function Page({ searchParams }: Props) {
  const { room } = await searchParams;
  const roomId = parseRoomId(room);
  if (!roomId) redirect(`/?room=${newRoomId()}`);
  // Invite-only: everyone but the owner and allowed accounts gets the gate.
  const access = await roomAccess();
  if (access.locked) return <PrivateGate signedIn={access.signedIn} email={access.email} />;
  return <ClientShell roomId={roomId} searchEnabled={!!process.env.YOUTUBE_API_KEY} pass={access.pass} />;
}
