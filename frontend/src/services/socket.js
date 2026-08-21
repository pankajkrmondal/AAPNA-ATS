/**
 * socket.js — shared Socket.io client singleton.
 *
 * Connects to the backend using the stored JWT. In dev, Vite proxies
 * `/socket.io` (ws) to the backend, so a same-origin connection works; in
 * staging/prod set VITE_API_URL to the backend origin.
 *
 * Real-time events used by the app:
 *   - 'upload:job'  → an upload job's status changed (uploader's room)
 *   - 'review:new'  → a duplicate needs recruiter review (role rooms)
 */
import { io } from 'socket.io-client';

let socket = null;

/** Lazily create (or return) the shared socket. Returns null if not logged in. */
export function getSocket() {
  if (socket) return socket;

  const token = localStorage.getItem('ats_token');
  if (!token) return null;

  const url = import.meta.env.VITE_API_URL || undefined; // undefined → same origin (dev proxy)
  socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  // A failed handshake is otherwise completely silent: reconnection is infinite, so
  // there is no error to surface and the only symptom is a page that quietly stops
  // updating. Log it — a rejected token and a proxy that won't upgrade the connection
  // look identical from the UI, and this is the line that tells them apart.
  socket.on('connect_error', (err) => {
    console.warn(`[socket] connect_error: ${err?.message || err}`);
  });
  socket.on('disconnect', (reason) => {
    console.warn(`[socket] disconnected: ${reason}`);
  });

  return socket;
}

/** Disconnect and clear the singleton (call on logout). */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
