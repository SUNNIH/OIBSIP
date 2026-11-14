import { useState, useEffect } from 'react';
import * as ordersApi from '../api/orders.js';
import { orderSocket } from '../realtime/socket.js';
import * as catalogueApi from '../api/catalogue.js';
import { useOrderPolling, detectOrderTransition } from '../hooks/useOrderPolling.js';

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Map backend order states to customer-friendly display
function getOrderStatusDisplay(orderState, paymentStatus) {
  if (orderState === 'pending_payment') {
    return {
      label: 'Payment Pending',
      class: 'status--warning',
      icon: '⏳',
      description: 'Complete payment to confirm your order'
    };
  }
  
  if (orderState === 'expired') {
    return {
      label: 'Expired',
      class: 'status--error',
      icon: '⚠️',
      description: 'Order reservation has expired'
    };
  }
  
  if (orderState === 'received') {
    return {
      label: 'Order Received',
      class: 'status--success',
      icon: '✓',
      description: 'We have received your order'
    };
  }
  
  if (orderState === 'in_kitchen') {
    return {
      label: 'In Kitchen',
      class: 'status--active',
      icon: '👨‍🍳',
      description: 'Your pizzas are being freshly prepared'
    };
  }
  
  if (orderState === 'sent_to_delivery') {
    return {
      label: 'Sent to Delivery',
      class: 'status--delivery',
      icon: '🚚',
      description: 'Your order is on its way'
    };
  }
  
  return {
    label: orderState,
    class: 'status--default',
    icon: '📋',
    description: ''
  };
}

// Progress tracker for fulfilled orders
function OrderProgress({ orderState }) {
  const stages = [
    { state: 'received', label: 'Order Received' },
    { state: 'in_kitchen', label: 'In Kitchen' },
    { state: 'sent_to_delivery', label: 'Sent to Delivery' }
  ];

  // Don't show progress for pending or expired orders
  if (orderState === 'pending_payment' || orderState === 'expired') {
    return null;
  }

  const currentIndex = stages.findIndex(stage => stage.state === orderState);

  return (
    <div className="order-progress">
      <h3 className="order-progress__title">Order Progress</h3>
      <div className="order-progress__track">
        {stages.map((stage, index) => {
          const isCompleted = index <= currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div
              key={stage.state}
              className={`progress-stage ${isCompleted ? 'progress-stage--completed' : ''} ${isCurrent ? 'progress-stage--current' : ''}`}
            >
              <div className="progress-stage__marker">
                {isCompleted ? '✓' : index + 1}
              </div>
              <div className="progress-stage__label">{stage.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OrderDetails({ orderId, onBack, onNotice }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previousOrderState, setPreviousOrderState] = useState(null);

  // Initial load
  useEffect(() => {
    let active = true;

    setOrder(null);
    setLoading(true);
    setError('');

    async function fetchOrder() {
      try {
        const latestOrder = await ordersApi.getOrder(orderId);

        if (!active) return;

        setOrder(latestOrder);
        setPreviousOrderState(latestOrder.orderState);
        setError('');

      } catch (err) {
        if (!active) return;

        console.error('Failed to fetch order:', err);
        setError(err.message || 'Failed to load order details');

        if (err.status === 401) {
          onNotice('Please sign in to view order details');
        } else if (err.status === 404) {
          onNotice('Order not found');
        }

      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (orderId) {
      fetchOrder();
    } else {
      setLoading(false);
      setError('Invalid order ID');
    }

    return () => {
      active = false;
    };
  }, [orderId, onNotice]);

  // Polling for live updates (only after initial load)
  const { data: polledOrder } = useOrderPolling(
    async () => {
      return await ordersApi.getOrder(orderId);
    },
    15000, // Poll every 15 seconds
    {
      enabled: !loading && !!order && !!orderId,
      onUpdate: (newOrder, oldOrder) => {
        const transition = detectOrderTransition(newOrder, oldOrder);
        
        if (transition) {
          const statusLabels = {
            pending_payment: 'Payment Pending',
            received: 'Order Received',
            in_kitchen: 'In Kitchen',
            sent_to_delivery: 'Out for Delivery',
            expired: 'Expired'
          };
          
          onNotice(`Order status updated: ${statusLabels[transition.to] || transition.to}`);
        }
        
        setOrder(newOrder);
        setPreviousOrderState(newOrder.orderState);
      }
    }
  );


  if (loading) {
    return (
      <main className="order-details-page shell">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading order details...</p>
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="order-details-page shell">
        <div className="error-state">
          <div className="error-state__icon">⚠️</div>
          <h2>Unable to load order</h2>
          <p>{error || 'Order not found'}</p>
          <button
            type="button"
            className="button button--primary"
            onClick={onBack}
          >
            Back to orders
          </button>
        </div>
      </main>
    );
  }

  const status = getOrderStatusDisplay(order.orderState, order.paymentStatus);
  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const orderDate = new Date(order.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <main className="order-details-page shell">
      <div className="page-header">
        <button
          type="button"
          className="back-button"
          onClick={onBack}
        >
          ← Back to orders
        </button>
      </div>

      <div className="order-details-container">
        <div className="order-details-main">
          <div className="order-status-card">
            <div className="order-status-card__icon">{status.icon}</div>
            <div>
              <h1 className="order-status-card__title">{status.label}</h1>
              <p className="order-status-card__description">{status.description}</p>
            </div>
            <span className={`order-status-badge ${status.class}`}>
              {status.label}
            </span>
          </div>

          <OrderProgress orderState={order.orderState} />

          <div className="order-info-card">
            <h2>Order Information</h2>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Order ID</span>
                <span className="info-value">#{order.orderId}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Date</span>
                <span className="info-value">{orderDate}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Items</span>
                <span className="info-value">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Payment Status</span>
                <span className="info-value" style={{ textTransform: 'capitalize' }}>
                  {order.paymentStatus.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>

          <div className="order-items-card">
            <h2>Order Items</h2>
            <div className="items-list">
              {order.items.map((item, index) => (
                <div key={index} className="item-detail">
                  <div className="item-detail__main">
                    <div>
                      <h3 className="item-detail__name">{item.name}</h3>
                      <div className="item-detail__ingredients">
                        <span className="ingredient-tag">{item.base.name}</span>
                        <span className="ingredient-tag">{item.sauce.name}</span>
                        <span className="ingredient-tag">{item.cheese.name}</span>
                        {item.vegetables && item.vegetables.length > 0 && (
                          item.vegetables.map((veg, vegIndex) => (
                            <span key={vegIndex} className="ingredient-tag ingredient-tag--veg">
                              {veg.name}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="item-detail__pricing">
                      <div className="item-detail__qty">Qty: {item.quantity}</div>
                      <div className="item-detail__price">
                        {catalogueApi.formatPrice(item.lineTotalPaise)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="order-details-sidebar">
          <div className="order-summary-card">
            <h2>Order Summary</h2>
            <div className="summary-rows">
              {order.items.map((item, index) => (
                <div key={index} className="summary-row">
                  <span className="summary-item">
                    {item.name} ×{item.quantity}
                  </span>
                  <span className="summary-price">
                    {catalogueApi.formatPrice(item.lineTotalPaise)}
                  </span>
                </div>
              ))}
              <div className="summary-divider" />
              <div className="summary-row summary-row--total">
                <span className="summary-label">Total</span>
                <span className="summary-total">
                  {catalogueApi.formatPrice(order.totalPricePaise)}
                </span>
              </div>
            </div>
          </div>

          {order.reservationExpiresAt && (
            <div className="order-notice order-notice--warning">
              <strong>Payment Required</strong>
              <p>
                Please complete payment before{' '}
                {new Date(order.reservationExpiresAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
