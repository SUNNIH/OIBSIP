import { createServer } from 'node:http';
import { createSocketServer } from './realtime/socket.js';

import app from './app.js';

import env from './config/env.js';

import { connectDB } from './db/connection.js';

import {
  startReservationExpirationWorker
} from './services/reservationExpirationWorker.js';

import {
  startLowStockScheduler,
  stopLowStockScheduler
} from './services/lowStockScheduler.js';

const startServer = async () => {

  // Connect to MongoDB
  await connectDB();

// Create HTTP server for Express and Socket.IO
const server = createServer(app);

// Attach authenticated Socket.IO server
const io = createSocketServer(server);

// Make Socket.IO available to authorized Express routes
app.set('io', io);

// Start HTTP server
server.listen(env.PORT, () => {
  console.log(
    `✓ Server running on port ${env.PORT} in ${env.NODE_ENV} mode`
  );
});

  // Task 4.6C: Start automatic reservation expiration worker
  const expirationWorker =
    startReservationExpirationWorker();

  // Section 6.3.5: Start low-stock notification scheduler
  const lowStockScheduler =
    startLowStockScheduler();

  let shuttingDown = false;

  // Graceful shutdown
  const shutdown = (signal) => {

    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.log(
      `\n${signal} received, shutting down gracefully...`
    );

    // Stop scheduling expiration checks
    const workerStopped = expirationWorker.stop();

    // Stop low-stock scheduler
    stopLowStockScheduler();

   // Close Socket.IO connections and the underlying HTTP server
io.close(async (closeError) => {

      try {

        // Wait for active expiration sweep
        await workerStopped;

        // Disconnect MongoDB
        const { disconnectDB } = await import(
          './db/connection.js'
        );

        await disconnectDB();

        if (closeError) {
          throw closeError;
        }

        console.log('✓ Server shut down successfully');

        process.exit(0);

      } catch (error) {

        console.error(
          '❌ Server shutdown failed:',
          error
        );

        process.exit(1);
      }

    });

  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('SIGINT', () => shutdown('SIGINT'));

};

startServer().catch((error) => {

  console.error('❌ Server startup failed:', error);

  process.exit(1);

});