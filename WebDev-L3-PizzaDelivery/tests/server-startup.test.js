import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi
} from 'vitest';

// Mock external dependencies to prevent real database connections,
// HTTP listeners, Socket.IO connections, and background workers.
const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),

  createServer: vi.fn(),
  listen: vi.fn(),

  createSocketServer: vi.fn(),
  closeSocketServer: vi.fn(),

  set: vi.fn(),

  startReservationExpirationWorker: vi.fn(),
  stopReservationExpirationWorker: vi.fn(),

  startLowStockScheduler: vi.fn(),
  stopLowStockScheduler: vi.fn()
}));

// Mock Node HTTP server.
vi.mock('node:http', () => ({
  createServer: mocks.createServer
}));

// Mock Express application.
vi.mock('../server/src/app.js', () => ({
  default: {
    set: mocks.set
  }
}));

// Mock Socket.IO initialization.
// Prevents importing authentication and Mongoose models.
vi.mock('../server/src/realtime/socket.js', () => ({
  createSocketServer: mocks.createSocketServer
}));

// Mock environment configuration.
vi.mock('../server/src/config/env.js', () => ({
  default: {
    PORT: 5001,
    NODE_ENV: 'test'
  }
}));

// Mock database connection management.
vi.mock('../server/src/db/connection.js', () => ({
  connectDB: mocks.connectDB,
  disconnectDB: mocks.disconnectDB
}));

// Mock reservation expiration worker.
vi.mock('../server/src/services/reservationExpirationWorker.js', () => ({
  startReservationExpirationWorker:
    mocks.startReservationExpirationWorker
}));

// Mock low-stock scheduler.
vi.mock('../server/src/services/lowStockScheduler.js', () => ({
  startLowStockScheduler:
    mocks.startLowStockScheduler,

  stopLowStockScheduler:
    mocks.stopLowStockScheduler
}));

describe('Server Startup and Shutdown', () => {
  const handlers = new Map();

  beforeEach(() => {
    // Reload server entry point independently for each test.
    vi.resetModules();
    vi.resetAllMocks();

    handlers.clear();

    const originalProcessOn = process.on.bind(process);

    // Capture shutdown handlers without registering real listeners.
    vi.spyOn(process, 'on').mockImplementation(
      (event, handler) => {
        if (event === 'SIGTERM' || event === 'SIGINT') {
          handlers.set(event, handler);
          return process;
        }

        return originalProcessOn(event, handler);
      }
    );

    // Prevent tests from terminating Vitest.
    vi.spyOn(process, 'exit').mockImplementation(
      () => undefined
    );

    // Suppress expected startup/shutdown logs.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock successful database operations.
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.disconnectDB.mockResolvedValue(undefined);

    // Mock reservation worker lifecycle.
    mocks.stopReservationExpirationWorker.mockResolvedValue(
      undefined
    );

    mocks.startReservationExpirationWorker.mockReturnValue({
      stop: mocks.stopReservationExpirationWorker
    });

    // Create mock HTTP server.
    const httpServer = {
      listen: mocks.listen
    };

    // Create mock Socket.IO server.
    const io = {
      close: mocks.closeSocketServer
    };

    mocks.createServer.mockReturnValue(httpServer);
    mocks.createSocketServer.mockReturnValue(io);

    // Mock low-stock scheduler startup.
    mocks.startLowStockScheduler.mockReturnValue(undefined);

    // Simulate successful HTTP server startup.
    mocks.listen.mockImplementation((port, callback) => {
      callback?.();

      return httpServer;
    });

    // Simulate successful Socket.IO shutdown.
    mocks.closeSocketServer.mockImplementation(callback => {
      callback?.();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------
  // TEST 1: DATABASE AND SERVER STARTUP
  // ---------------------------------------------------------

  it('connects to MongoDB before starting the server', async () => {
    // Keep the database connection pending initially.
    let resolveConnection;

    mocks.connectDB.mockImplementation(
      () => new Promise(resolve => {
        resolveConnection = resolve;
      })
    );

    // Import the application entry point.
    await import('../server/src/index.js');

    // Database connection must begin first.
    expect(mocks.connectDB).toHaveBeenCalledTimes(1);

    // Server must not start before database connection completes.
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();

    expect(
      mocks.startReservationExpirationWorker
    ).not.toHaveBeenCalled();

    expect(
      mocks.startLowStockScheduler
    ).not.toHaveBeenCalled();

    // Complete the mocked database connection.
    resolveConnection();

    // Verify the HTTP server begins listening.
    await vi.waitFor(() => {
      expect(mocks.listen).toHaveBeenCalledWith(
        5001,
        expect.any(Function)
      );
    });

    // Verify HTTP server creation.
    expect(mocks.createServer).toHaveBeenCalledTimes(1);

    expect(mocks.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        set: mocks.set
      })
    );

    const httpServer =
      mocks.createServer.mock.results[0].value;

    const io =
      mocks.createSocketServer.mock.results[0].value;

    // Verify Socket.IO initialization.
    expect(
      mocks.createSocketServer
    ).toHaveBeenCalledTimes(1);

    expect(
      mocks.createSocketServer
    ).toHaveBeenCalledWith(httpServer);

    // Verify Socket.IO is attached to Express.
    expect(mocks.set).toHaveBeenCalledWith(
      'io',
      io
    );

    // Verify reservation worker startup.
    expect(
      mocks.startReservationExpirationWorker
    ).toHaveBeenCalledTimes(1);

    // Verify low-stock scheduler startup.
    expect(
      mocks.startLowStockScheduler
    ).toHaveBeenCalledTimes(1);

    // Verify startup confirmation message.
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'Server running on port 5001 in test mode'
      )
    );

    // Verify signal handlers were registered.
    expect(handlers.has('SIGTERM')).toBe(true);
    expect(handlers.has('SIGINT')).toBe(true);
  });

  // ---------------------------------------------------------
  // TEST 2 & 3: GRACEFUL SHUTDOWN
  // ---------------------------------------------------------

  it.each(['SIGTERM', 'SIGINT'])(
    'shuts down gracefully when %s is received',
    async signal => {
      await import('../server/src/index.js');

      // Wait for server initialization.
      await vi.waitFor(() => {
        expect(handlers.has(signal)).toBe(true);
      });

      // Simulate the shutdown signal.
      handlers.get(signal)();

      await vi.waitFor(() => {
        // Reservation worker should stop.
        expect(
          mocks.stopReservationExpirationWorker
        ).toHaveBeenCalledTimes(1);

        // Low-stock scheduler should stop.
        expect(
          mocks.stopLowStockScheduler
        ).toHaveBeenCalledTimes(1);

        // Socket.IO should close.
        expect(
          mocks.closeSocketServer
        ).toHaveBeenCalledTimes(1);

        // MongoDB should disconnect.
        expect(
          mocks.disconnectDB
        ).toHaveBeenCalledTimes(1);

        // Process should exit successfully.
        expect(process.exit).toHaveBeenCalledWith(0);
      });

      // Repeated shutdown signals must not restart shutdown.
      handlers.get(signal)();

      expect(
        mocks.closeSocketServer
      ).toHaveBeenCalledTimes(1);

      expect(
        mocks.disconnectDB
      ).toHaveBeenCalledTimes(1);
    }
  );

  // ---------------------------------------------------------
  // TEST 4: SERVER STARTUP FAILURE
  // ---------------------------------------------------------

  it('handles server startup failures', async () => {
    // Simulate a failed MongoDB connection.
    mocks.connectDB.mockRejectedValue(
      new Error('Database startup failed')
    );

    await import('../server/src/index.js');

    // Startup failure should terminate the process.
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // HTTP server must not start.
    expect(
      mocks.createServer
    ).not.toHaveBeenCalled();

    expect(
      mocks.createSocketServer
    ).not.toHaveBeenCalled();

    expect(
      mocks.listen
    ).not.toHaveBeenCalled();

    // Background workers must not start.
    expect(
      mocks.startReservationExpirationWorker
    ).not.toHaveBeenCalled();

    expect(
      mocks.startLowStockScheduler
    ).not.toHaveBeenCalled();

    // Verify the startup error is logged.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Server startup failed'
      ),
      expect.objectContaining({
        message: 'Database startup failed'
      })
    );
  });
});