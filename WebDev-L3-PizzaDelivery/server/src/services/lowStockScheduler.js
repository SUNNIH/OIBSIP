// SUNNYS Pizza — Low Stock Notification Scheduler
// Periodically checks inventory and sends alerts using node-cron

import cron from 'node-cron';
import { checkAndNotify } from './lowStockNotification.js';
import env from '../config/env.js';

let scheduledTask = null;

/**
 * Start the low-stock notification scheduler
 * Default: runs every hour at the top of the hour (0 * * * *)
 * Only starts after MongoDB connection is established
 */
export const startLowStockScheduler = (cronExpression = '0 * * * *') => {
  // Don't start scheduler in test environment
  if (env.NODE_ENV === 'test') {
    console.log('⏭️  Low-stock scheduler disabled in test mode');
    return { stop: () => {}, isScheduled: () => false };
  }

  if (scheduledTask) {
    console.warn('⚠️  Low-stock scheduler already running');
    return { stop: () => stopLowStockScheduler(), isScheduled: () => true };
  }

  // Validate cron expression
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log('🔍 Running scheduled low-stock check...');
    const result = await checkAndNotify();
    
    if (result.alerted) {
      console.log(`✓ Low-stock alert sent (${result.itemCount} items)`);
    } else if (result.reason === 'stock_adequate') {
      console.log('✓ All stock levels adequate');
    } else if (result.reason === 'already_alerted') {
      console.log('⏭️  Low-stock items already alerted, waiting for recovery');
    } else if (result.reason === 'send_failed') {
      console.error('❌ Failed to send low-stock alert:', result.error);
    }
  });

  console.log(`✓ Low-stock scheduler started (${cronExpression})`);
  
  return {
    stop: () => stopLowStockScheduler(),
    isScheduled: () => scheduledTask !== null,
  };
};

/**
 * Stop the low-stock notification scheduler
 */
export const stopLowStockScheduler = () => {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('✓ Low-stock scheduler stopped');
    return true;
  }
  return false;
};

/**
 * Check if scheduler is running
 */
export const isSchedulerRunning = () => {
  return scheduledTask !== null;
};

/**
 * Run immediate low-stock check (bypasses schedule)
 * Useful for manual triggers or testing
 */
export const runImmediateCheck = async () => {
  console.log('🔍 Running immediate low-stock check...');
  return await checkAndNotify();
};
