import { io } from 'socket.io-client';

// Use the configured backend URL when available.
// Local development uses the verified backend port 5000.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV
    ? 'http://localhost:5000'
    : window.location.origin);

export const orderSocket = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
  timeout: 5000
});