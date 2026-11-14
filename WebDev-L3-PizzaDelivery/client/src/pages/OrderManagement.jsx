// SUNNYS Pizza — Admin Order Management
// Requires administrator authentication

import { useEffect, useState } from 'react';
import * as adminApi from '../api/admin.js';

// Format paise to rupees
function formatRupees(paise) {
  if (typeof paise !== 'number' || isNaN(paise)) return '₹0.00';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format timestamp to be more compact
function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    // Today: show time only
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } else if (diffDays < 7) {
    // This week: show day and time
    return date.toLocaleString('en-IN', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } else {
    // Older: show date
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

// Map order state to display label
function getOrderStateLabel(state) {
  const labels = {
    pending_payment: 'Pending Payment',
    received: 'Order Received',
    in_kitchen: 'In Kitchen',
    sent_to_delivery: 'Out for Delivery',
    expired: 'Expired'
  };
  return labels[state] || state;
}

// Get payment status label
function getPaymentStatusLabel(status) {
  const labels = {
    pending: 'Pending',
    paid: 'Paid',
    paid_after_expiry: 'Paid (Late)',
    failed: 'Failed'
  };
  return labels[status] || status;
}

// Get next allowed status
function getNextStatus(currentState) {
  const transitions = {
    received: 'in_kitchen',
    in_kitchen: 'sent_to_delivery'
  };
  return transitions[currentState] || null;
}

// Get next status label
function getNextStatusLabel(nextStatus) {
  return nextStatus ? getOrderStateLabel(nextStatus) : null;
}

// Order Details Modal
function OrderDetailsModal({ orderId, onClose, onStatusUpdate, csrfToken }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    async function fetchOrder() {
      try {
        setLoading(true);
        const data = await adminApi.getOrderDetails(orderId);
        setOrder(data.order);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [orderId]);

  const handleAdvanceStatus = async () => {
    if (!order) return;
    
    const nextStatus = getNextStatus(order.orderState);
    if (!nextStatus) return;

    try {
      setUpdating(true);
      setError(null);
      await adminApi.updateOrderStatus(orderId, nextStatus, csrfToken);
      
      // Refresh order details
      const data = await adminApi.getOrderDetails(orderId);
      setOrder(data.order);
      
      // Notify parent to refresh list
      if (onStatusUpdate) onStatusUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content modal-content--large" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Order Details</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="loading-state">
              <div className="spinner" />
              <p>Loading order details...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content modal-content--large" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Order Details</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="error-state">
              <p>{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const nextStatus = getNextStatus(order.orderState);
  const canAdvance = nextStatus && ['paid', 'paid_after_expiry'].includes(order.paymentStatus);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Order Details</h2>
          <button className="modal-close" onClick={onClose} disabled={updating}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="order-details">
            <div className="order-details-section">
              <h3>Order Information</h3>
              <dl className="order-info-list">
                <dt>Order ID:</dt>
                <dd>{order.orderId}</dd>
                
                <dt>Customer:</dt>
                <dd>{order.customerEmail}</dd>
                
                <dt>Status:</dt>
                <dd>
                  <span className={`order-badge order-badge--${order.orderState}`}>
                    {getOrderStateLabel(order.orderState)}
                  </span>
                </dd>
                
                <dt>Payment:</dt>
                <dd>
                  <span className={`payment-badge payment-badge--${order.paymentStatus}`}>
                    {getPaymentStatusLabel(order.paymentStatus)}
                  </span>
                </dd>
                
                <dt>Total:</dt>
                <dd className="order-total">{formatRupees(order.totalPricePaise)}</dd>
                
                <dt>Created:</dt>
                <dd>{formatDate(order.createdAt)}</dd>
                
                {order.paymentCapturedAt && (
                  <>
                    <dt>Paid:</dt>
                    <dd>{formatDate(order.paymentCapturedAt)}</dd>
                  </>
                )}
              </dl>
            </div>

            <div className="order-details-section">
              <h3>Order Items</h3>
              <div className="order-items-list">
                {order.items.map((item, index) => (
                  <div key={index} className="order-item-card">
                    <div className="order-item-header">
                      <span className="order-item-name">{item.name}</span>
                      <span className="order-item-qty">×{item.quantity}</span>
                    </div>
                    <div className="order-item-ingredients">
                      <span>Base: {item.base}</span>
                      <span>Sauce: {item.sauce}</span>
                      <span>Cheese: {item.cheese}</span>
                      {item.vegetables.length > 0 && (
                        <span>Vegetables: {item.vegetables.join(', ')}</span>
                      )}
                    </div>
                    <div className="order-item-price">
                      {formatRupees(item.totalPricePaise)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            {canAdvance && (
              <div className="order-actions">
                <button
                  className="button button--primary"
                  onClick={handleAdvanceStatus}
                  disabled={updating}
                >
                  {updating ? 'Updating...' : `Advance to ${getNextStatusLabel(nextStatus)}`}
                </button>
              </div>
            )}

            {!canAdvance && order.paymentStatus === 'pending' && (
              <div className="order-warning">
                <p>⚠️ Cannot advance order until payment is confirmed.</p>
              </div>
            )}

            {order.orderState === 'sent_to_delivery' && (
              <div className="order-success">
                <p>✓ Order is out for delivery.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function OrderManagement({ user, onNavigate, csrfToken }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getAllOrders({ limit: 50 });
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== 'admin') return;
    fetchOrders();
  }, [user?.role]);

  const handleOrderClick = (orderId) => {
    setSelectedOrderId(orderId);
  };

  const handleModalClose = () => {
    setSelectedOrderId(null);
  };

  const handleStatusUpdate = () => {
    // Refresh orders list
    fetchOrders();
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="admin-content">
        <div className="admin-content__error">
          <h2>Access Denied</h2>
          <p>You must be an administrator to view this page.</p>
          <button className="button button--primary" onClick={() => onNavigate('home')}>
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-content">
        <div className="admin-content__header">
          <h1>Order Management</h1>
        </div>
        <div className="admin-content__loading">
          <div className="spinner" />
          <p>Loading orders...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-content">
        <div className="admin-content__header">
          <h1>Order Management</h1>
        </div>
        <div className="admin-content__error">
          <p>{error}</p>
          <button className="button button--primary" onClick={fetchOrders}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-content">
      <div className="admin-content__header">
        <h1>Order Management</h1>
        <p className="admin-content__subtitle">
          View and manage customer orders
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="admin-content__empty">
          <p>No orders found.</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="orders-table-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.orderId} className="order-row">
                    <td className="order-cell-id">#{order.orderId.slice(-8)}</td>
                    <td>{order.customerEmail}</td>
                    <td>{formatRupees(order.totalPricePaise)}</td>
                    <td>
                      <span className={`order-badge order-badge--${order.orderState}`}>
                        {getOrderStateLabel(order.orderState)}
                      </span>
                    </td>
                    <td>
                      <span className={`payment-badge payment-badge--${order.paymentStatus}`}>
                        {getPaymentStatusLabel(order.paymentStatus)}
                      </span>
                    </td>
                    <td>{formatDate(order.createdAt)}</td>
                    <td>
                      <button
                        className="button button--small button--secondary"
                        onClick={() => handleOrderClick(order.orderId)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="orders-mobile-list">
            {orders.map(order => (
              <div key={order.orderId} className="order-mobile-card">
                <div className="order-mobile-card__header">
                  <div className="order-mobile-card__id">#{order.orderId.slice(-8)}</div>
                  <span className={`order-badge order-badge--${order.orderState}`}>
                    {getOrderStateLabel(order.orderState)}
                  </span>
                </div>
                
                <div className="order-mobile-card__row">
                  <span className="order-mobile-card__label">Customer</span>
                  <span className="order-mobile-card__value">{order.customerEmail}</span>
                </div>
                
                <div className="order-mobile-card__row">
                  <span className="order-mobile-card__label">Amount</span>
                  <span className="order-mobile-card__value">{formatRupees(order.totalPricePaise)}</span>
                </div>
                
                <div className="order-mobile-card__row">
                  <span className="order-mobile-card__label">Payment</span>
                  <span className={`payment-badge payment-badge--${order.paymentStatus}`}>
                    {getPaymentStatusLabel(order.paymentStatus)}
                  </span>
                </div>
                
                <div className="order-mobile-card__row">
                  <span className="order-mobile-card__label">Date</span>
                  <span className="order-mobile-card__value">{formatDate(order.createdAt)}</span>
                </div>
                
                <div className="order-mobile-card__actions">
                  <button
                    className="button button--primary"
                    onClick={() => handleOrderClick(order.orderId)}
                    style={{ width: '100%' }}
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selectedOrderId && (
        <OrderDetailsModal
          orderId={selectedOrderId}
          onClose={handleModalClose}
          onStatusUpdate={handleStatusUpdate}
          csrfToken={csrfToken}
        />
      )}
    </div>
  );
}
