import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

import env from '../config/env.js';
import User from '../models/User.js';

// Validate a customer using the existing JWT authentication system.
async function authenticateCustomer(token) {
  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, env.JWT_SECRET);

  const user = await User.findById(decoded.sub);

  if (
    !user ||
    user.tokenVersion !== decoded.tokenVersion ||
    !user.isVerified ||
    user.role !== 'customer'
  ) {
    return null;
  }

  return user._id.toString();
}

// Attach Socket.IO to the existing HTTP server.
export function createSocketServer(httpServer) {
  const allowedOrigin = new URL(env.CLIENT_URL).origin;

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      credentials: true
    },

    // CORS alone does not protect WebSocket upgrades.
    allowRequest: (req, callback) => {
      callback(null, req.headers.origin === allowedOrigin);
    },

    serveClient: false
  });

  // Parse the existing authentication cookie.
  io.engine.use(cookieParser(env.CSRF_SECRET));

  // Authenticate every incoming Socket.IO connection.
  io.use(async (socket, next) => {
    try {
      const token = socket.request.cookies?.token;

      const userId = await authenticateCustomer(token);

      if (!userId) {
        return next(new Error('Authentication required'));
      }

      socket.data.userId = userId;

      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const customerId = socket.data.userId;

    // Customers can only join their own server-assigned room.
    socket.join(`customer:${customerId}`);

    console.log('Authenticated customer socket connected');

    // Periodically check for revoked or expired sessions.
    const sessionCheck = setInterval(async () => {
      try {
        const validUserId = await authenticateCustomer(
          socket.request.cookies?.token
        );

        if (validUserId !== customerId) {
          socket.disconnect(true);
        }
      } catch {
        socket.disconnect(true);
      }
    }, 60_000);

    sessionCheck.unref?.();

    socket.on('disconnect', () => {
      clearInterval(sessionCheck);

      console.log('Customer socket disconnected');
    });
  });

  return io;
}

/**
 * Notify the owner of an order after a successful database update.
 *
 * The notification contains only the order ID.
 * Customers retrieve current order information using
 * the existing authenticated REST endpoint.
 */
export function notifyOrderUpdated(io, order) {
  if (!io || !order?._id || !order?.customerId) {
    throw new Error('Valid Socket.IO server and order required');
  }

  const customerId = order.customerId.toString();
  const orderId = order._id.toString();

  // Send only to the order owner's server-assigned room.
  io.to(`customer:${customerId}`).emit('order:updated', {
    orderId
  });
}