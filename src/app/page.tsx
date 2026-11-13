import { redirect } from 'next/navigation';
import { ClientShell } from '../components/ClientShell';
import { newRoomId, parseRoomId } from '../shared/room';

interface Props {
  searchParams: Promise<{ room?: string | string[] }>;
}

/** Rooms live in `?room=`. A visit without one gets a fresh room before any JS runs. */
export default async function Page({ searchParams }: Props) {
  const { room } = await searchParams;
  const roomId = parseRoomId(room);
  if (!roomId) redirect(`/?room=${newRoomId()}`);
  return <ClientShell roomId={roomId} />;
}
