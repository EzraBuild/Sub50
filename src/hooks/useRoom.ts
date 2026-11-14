import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage, Peer, Reaction, RoomState } from '../shared/protocol';
import type { FloatingReaction } from '../components/Reactions';
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
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});

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
        case 'REACTION': {
          const r: FloatingReaction = { id: msg.id, emoji: msg.emoji, name: msg.name, x: 12 + Math.random() * 76, sway: (Math.random() - 0.5) * 90 };
          setReactions((prev) => [...prev.slice(-29), r]);
          setTimeout(() => setReactions((prev) => prev.filter((p) => p.id !== r.id)), 2700);
          break;
        }
        case 'CHAT_HISTORY':
          setMessages(msg.messages);
          break;
        case 'CHAT':
          setMessages((prev) => (prev.some((m) => m.id === msg.message.id) ? prev : [...prev.slice(-99), msg.message]));
          setTyping(({ [msg.message.peerId]: _done, ...rest }) => rest);
          break;
        case 'TYPING':
          if (msg.peerId !== client.sessionId) setTyping((prev) => ({ ...prev, [msg.peerId]: { name: msg.name, until: Date.now() + 3500 } }));
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
    const rttTimer = setInterval(() => {
      setRttMs(client.clock.rtt === null ? null : Math.round(client.clock.rtt));
      // Expire "is typing" lines.
      setTyping((prev) => {
        const now = Date.now();
        const live = Object.entries(prev).filter(([, t]) => t.until > now);
        return live.length === Object.keys(prev).length ? prev : Object.fromEntries(live);
      });
    }, 1000);
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
      queueAdd: (url: string, title?: string) => client.send({ type: 'QUEUE_ADD', roomId, url, ...(title ? { title } : {}) }),
      queueRemove: (itemId: string) => client.send({ type: 'QUEUE_REMOVE', roomId, itemId }),
      queuePlay: (itemId: string) => client.send({ type: 'QUEUE_PLAY', roomId, itemId }),
      play: (timestamp: number) => client.send({ type: 'PLAY', roomId, timestamp }),
      pause: (timestamp: number) => client.send({ type: 'PAUSE', roomId, timestamp }),
      seek: (timestamp: number) => client.send({ type: 'SEEK', roomId, timestamp }),
      react: (emoji: Reaction) => client.send({ type: 'REACT', roomId, emoji }),
      chat: (text: string) => client.send({ type: 'CHAT_SEND', roomId, text }),
      typing: () => client.send({ type: 'TYPING', roomId }),
      voteSkip: (trackId: string, vote: boolean) => client.send({ type: 'VOTE_SKIP', roomId, trackId, vote }),
    }),
    [client, roomId],
  );

  const notify = (message: string) => setToast({ id: Date.now(), message });

  const typingNames = Object.values(typing).map((t) => t.name);

  return { client, state, peers, connection, rttMs, selfId, lanAddresses, toast, notify, actions, reactions, messages, typingNames };
}
