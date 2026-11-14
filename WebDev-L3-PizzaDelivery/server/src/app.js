import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { securityMiddleware } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import catalogueRouter from './routes/catalogue.js';
import ordersRouter from './routes/orders.js';
import paymentsRouter from './routes/payments.js';
import adminRouter from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security middleware
securityMiddleware(app);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve images from the appropriate storage directory.
const uploadsRoot = path.join(
  __dirname,
  process.env.NODE_ENV === 'test' ? '../test-uploads' : '../uploads'
);

app.use('/uploads', express.static(uploadsRoot));

// Routes
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/v1', catalogueRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/admin', adminRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
