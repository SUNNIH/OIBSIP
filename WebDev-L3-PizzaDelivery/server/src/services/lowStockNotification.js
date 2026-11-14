// SUNNYS Pizza — Low Stock Email Notification Service
// Detects low-stock ingredients and sends consolidated email alerts to admin

import Ingredient from '../models/Ingredient.js';
import { getEmailTransporter } from '../config/email.js';
import env from '../config/env.js';

// Track which ingredients have been alerted to prevent duplicate emails
const alertedIngredients = new Set();

/**
 * Detect low-stock ingredients
 * Returns active ingredients where available quantity <= lowStockThreshold
 */
export const detectLowStockIngredients = async () => {
  try {
    // Find active ingredients where stock - reserved <= lowStockThreshold
    const ingredients = await Ingredient.find({ isActive: true });
    
    const lowStockItems = ingredients.filter(ingredient => {
      const available = ingredient.stock - ingredient.reserved;
      return available <= ingredient.lowStockThreshold;
    });

    return lowStockItems;
  } catch (error) {
    console.error('❌ Error detecting low stock ingredients:', error.message);
    throw error;
  }
};

/**
 * Format low-stock email HTML
 */
const formatLowStockEmail = (lowStockItems) => {
  const rows = lowStockItems
    .map(ingredient => {
      const available = ingredient.stock - ingredient.reserved;
      const status = available === 0 ? 'OUT OF STOCK' : 'Low Stock';
      const rowClass = available === 0 ? 'out-of-stock' : 'low-stock';

      return `
        <tr class="${rowClass}">
          <td>${ingredient.name}</td>
          <td style="text-transform: capitalize;">${ingredient.category}</td>
          <td style="text-align: center;">${available}</td>
          <td style="text-align: center;">${ingredient.lowStockThreshold}</td>
          <td style="text-align: center; font-weight: bold;">${status}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        h2 {
          color: #d32f2f;
          border-bottom: 3px solid #d32f2f;
          padding-bottom: 10px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        th {
          background-color: #f5f5f5;
          padding: 12px;
          text-align: left;
          border: 1px solid #ddd;
          font-weight: bold;
        }
        td {
          padding: 10px;
          border: 1px solid #ddd;
        }
        .low-stock {
          background-color: #fff3e0;
        }
        .out-of-stock {
          background-color: #ffebee;
          font-weight: bold;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          color: #666;
          font-size: 0.9em;
        }
        .summary {
          background-color: #f5f5f5;
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>🔔 Low Stock Alert - SUNNYS Pizza</h2>
        
        <div class="summary">
          <strong>Alert Summary:</strong> ${lowStockItems.length} ingredient(s) require attention
        </div>

        <p>The following ingredients are running low or out of stock:</p>

        <table>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Category</th>
              <th>Available Qty</th>
              <th>Threshold</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="footer">
          <p><strong>Action Required:</strong> Please update stock levels in the Inventory Manager to ensure uninterrupted service.</p>
          <p>This is an automated notification from SUNNYS Pizza inventory management system.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Send low-stock alert email to admin
 */
export const sendLowStockAlert = async (lowStockItems) => {
  if (lowStockItems.length === 0) {
    return { success: true, reason: 'no_low_stock' };
  }

  if (!env.ADMIN_EMAIL) {
    console.warn('⚠️  ADMIN_EMAIL not configured, skipping low-stock notification');
    return { success: false, reason: 'no_admin_email' };
  }

  try {
    const transporter = await getEmailTransporter();
    const htmlContent = formatLowStockEmail(lowStockItems);

    const info = await transporter.sendMail({
      from: env.EMAIL_FROM || '"SUNNYS Pizza" <noreply@sunnyspizza.com>',
      to: env.ADMIN_EMAIL,
      subject: `🔔 Low Stock Alert - ${lowStockItems.length} Item(s) Need Attention`,
      html: htmlContent,
    });

    if (env.NODE_ENV === 'development' && env.EMAIL_HOST === 'ethereal') {
      console.log('📧 Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }

    console.log(`✓ Low stock alert sent to ${env.ADMIN_EMAIL} (${lowStockItems.length} items)`);
    return { success: true, messageId: info.messageId, itemCount: lowStockItems.length };
  } catch (error) {
    // Log error but don't crash the server
    console.error('❌ Failed to send low-stock alert:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Check inventory and send alert if needed (with duplicate prevention)
 */
export const checkAndNotify = async () => {
  try {
    const lowStockItems = await detectLowStockIngredients();

    if (lowStockItems.length === 0) {
      // All stock levels are adequate - clear alerted set
      if (alertedIngredients.size > 0) {
        console.log('✓ Stock levels recovered, clearing alert state');
        alertedIngredients.clear();
      }
      return { checked: true, alerted: false, reason: 'stock_adequate' };
    }

    // Check which items need new alerts
    const needsAlert = lowStockItems.filter(
      ingredient => !alertedIngredients.has(ingredient._id.toString())
    );

    if (needsAlert.length === 0) {
      // All low-stock items have already been alerted
      return { checked: true, alerted: false, reason: 'already_alerted' };
    }

    // Send alert for all current low-stock items (including previously alerted ones)
    // This provides a complete picture in each email
    const result = await sendLowStockAlert(lowStockItems);

    // Mark items as alerted if email was sent OR if ADMIN_EMAIL not configured
    // (we still track state to avoid repeated warnings)
    if (result.success || result.reason === 'no_admin_email') {
      lowStockItems.forEach(ingredient => {
        alertedIngredients.add(ingredient._id.toString());
      });
      
      if (result.success) {
        return { checked: true, alerted: true, itemCount: lowStockItems.length };
      } else {
        // ADMIN_EMAIL not configured - tracked but not sent
        return { checked: true, alerted: true, itemCount: lowStockItems.length, emailSkipped: true };
      }
    }

    return { checked: true, alerted: false, reason: 'send_failed', error: result.error };
  } catch (error) {
    console.error('❌ Error in checkAndNotify:', error.message);
    return { checked: false, error: error.message };
  }
};

/**
 * Clear alert state for a specific ingredient (called after stock update)
 * Allows new alert when stock drops below threshold again
 */
export const clearAlertState = (ingredientId) => {
  alertedIngredients.delete(ingredientId.toString());
};

/**
 * Get current alert state (for testing)
 */
export const getAlertState = () => {
  return Array.from(alertedIngredients);
};

/**
 * Reset alert state (for testing)
 */
export const resetAlertState = () => {
  alertedIngredients.clear();
};
