import { useEffect, useMemo, useState } from 'react';
import type { Peer, RoomState } from '../shared/protocol';
import { SyncClient, type ConnectionStatus } from '../lib/sync-client';

export interface Toast {
  id: number;
  message: string;
}

/** Owns the socket, mirrors room state into React, and exposes room actions. */
export function useRoom(roomId: string, username: string) {
  const client = useMemo(() => new SyncClient(), []);
  const [state, setState] = useState<RoomState | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    const offMsg = client.onMessage((msg) => {
      switch (msg.type) {
        case 'WELCOME':
          setSelfId(msg.clientId);
          setLanAddresses(msg.lanAddresses);
          break;
        case 'SYNC_STATE':
          setState(msg.state);
          break;
        case 'QUEUE_UPDATED':
          setState((prev) => (prev && prev.roomId === msg.roomId ? { ...prev, queue: msg.queue } : prev));
          break;
        case 'PEERS':
          setPeers(msg.peers);
          break;
        case 'ERROR':
          setToast({ id: Date.now(), message: msg.message });
          break;
        case 'PONG':
          break;
      }
    });
    const offStatus = client.onStatus(setConnection);
    client.start();
    const rttTimer = setInterval(() => setRttMs(client.clock.rtt === null ? null : Math.round(client.clock.rtt)), 1000);
    return () => {
      offMsg();
      offStatus();
      clearInterval(rttTimer);
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    client.setRoom(roomId, username);
  }, [client, roomId, username]);

  const actions = useMemo(
    () => ({
      changeVideo: (url: string) => client.send({ type: 'CHANGE_VIDEO', roomId, url }),
      queueAdd: (url: string) => client.send({ type: 'QUEUE_ADD', roomId, url }),
      queueRemove: (itemId: string) => client.send({ type: 'QUEUE_REMOVE', roomId, itemId }),
      queuePlay: (itemId: string) => client.send({ type: 'QUEUE_PLAY', roomId, itemId }),
      play: (timestamp: number) => client.send({ type: 'PLAY', roomId, timestamp }),
      pause: (timestamp: number) => client.send({ type: 'PAUSE', roomId, timestamp }),
      seek: (timestamp: number) => client.send({ type: 'SEEK', roomId, timestamp }),
    }),
    [client, roomId],
  );

  const notify = (message: string) => setToast({ id: Date.now(), message });

  return { client, state, peers, connection, rttMs, selfId, lanAddresses, toast, notify, actions };
}
