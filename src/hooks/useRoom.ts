import { useEffect, useMemo, useState } from 'react';
import type { Peer, RoomState } from '../shared/protocol';
import { getSessionId } from '../lib/identity';
import { SyncClient, type ConnectionStatus } from '../lib/sync-client';

export interface Toast {
  id: number;
  message: string;
}

/** Owns the socket, mirrors room state into React, and exposes room actions. */
export function useRoom(roomId: string, username: string) {
  const client = useMemo(() => new SyncClient(getSessionId()), []);
  const [state, setState] = useState<RoomState | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [rttMs, setRttMs] = useState<number | null>(null);
  // Our peer id is the tab's session id (stable across reconnects), not the connection id.
  const selfId = client.sessionId;
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    const offMsg = client.onMessage((msg) => {
      switch (msg.type) {
        case 'WELCOME':
          setLanAddresses(msg.lanAddresses);
          break;
        case 'SYNC_STATE':
          // With several server instances, broadcasts can arrive out of order;
          // never step back to an older version of the same room.
          setState((prev) =>
            prev && prev.roomId === msg.state.roomId && prev.epoch === msg.state.epoch && msg.state.seq < prev.seq
              ? prev
              : msg.state,
          );
          break;
        case 'PEERS':
          setPeers(msg.peers);
          break;
        case 'PEER_UPDATE':
          setPeers((prev) => prev.map((p) => (p.id === msg.peer.id ? msg.peer : p)));
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
