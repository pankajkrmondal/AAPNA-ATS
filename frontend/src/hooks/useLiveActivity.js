/**
 * useLiveActivity — subscribes to the shared socket and turns real-time backend events
 * into a capped, newest-first activity feed. Also tracks a running "duplicates to review"
 * count for the action center.
 *
 * Events (see services/socket.js):
 *   - 'upload:job'  → an upload job's status changed
 *   - 'review:new'  → a duplicate needs recruiter review
 */
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';

const MAX_FEED = 20;
let _id = 0;

export default function useLiveActivity() {
  const [events, setEvents] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socketRef.current = socket;

    const push = (entry) => {
      setEvents((prev) => [{ id: ++_id, at: Date.now(), ...entry }, ...prev].slice(0, MAX_FEED));
    };

    const onUpload = (payload = {}) => {
      const status = (payload.status || payload.state || '').toString();
      const name = payload.fileName || payload.name || payload.candidateName || 'A resume';
      push({
        type: 'upload',
        title: `${name}`,
        detail: status ? `Upload ${status}` : 'Upload updated',
        tone: status.toLowerCase().includes('fail') ? 'error' : status.toLowerCase().includes('complete') || status.toLowerCase().includes('done') ? 'success' : 'info',
      });
    };

    const onReview = (payload = {}) => {
      setReviewCount((c) => c + 1);
      push({
        type: 'review',
        title: payload.name || payload.candidateName || 'Possible duplicate',
        detail: 'Needs your review',
        tone: 'warning',
      });
    };

    socket.on('upload:job', onUpload);
    socket.on('review:new', onReview);

    return () => {
      socket.off('upload:job', onUpload);
      socket.off('review:new', onReview);
    };
  }, []);

  return { events, reviewCount };
}