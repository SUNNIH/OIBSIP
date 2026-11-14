// SUNNYS Pizza — Pending Order Ticker
// Shows active paid orders for the current customer with live polling.

import { useEffect, useState } from 'react';
import * as ordersApi from '../api/orders.js';
import { useOrderPolling } from '../hooks/useOrderPolling.js';

function getOrderStateLabel(orderState) {
  const labels = {
    received: 'Order Received',
    in_kitchen: 'In Kitchen',
    sent_to_delivery: 'Out for Delivery',
  };
  return labels[orderState] || orderState;
}

function isEligibleOrder(order) {
  const isPaid = ['paid', 'paid_after_expiry'].includes(order.paymentStatus);
  const activeStates = ['received', 'in_kitchen', 'sent_to_delivery'];
  return isPaid && activeStates.includes(order.orderState);
}

export function PendingOrderTicker({ user, onNavigate }) {
  const [activeOrders, setActiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const shouldShow = Boolean(user && user.role === 'customer');

  const fetchActiveOrders = async () => {
    try {
      const result = await ordersApi.getOrders(1, 20);
      return (result.orders || []).filter(isEligibleOrder);
    } catch (error) {
      console.error('Failed to fetch active orders:', error);
      return [];
    }
  };

  useEffect(() => {
    if (!shouldShow) {
      setActiveOrders([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    async function loadOrders() {
      const orders = await fetchActiveOrders();
      if (active) {
        setActiveOrders(orders);
        setLoading(false);
      }
    }

    loadOrders();
    return () => { active = false; };
  }, [shouldShow, user?.id, user?._id]);

  useOrderPolling(fetchActiveOrders, 15000, {
    enabled: !loading && shouldShow,
    onUpdate: (newOrders) => setActiveOrders(newOrders),
  });

  // App.jsx's navigate(next) takes ONE route string, and its order-details
  // route is #orders/<MongoDB ObjectId>, not #order-details.
  function goToOrder(orderId) {
    if (/^[0-9a-fA-F]{24}$/.test(orderId || '')) {
      onNavigate(`orders/${orderId}`);
    }
  }

  if (!shouldShow || loading || activeOrders.length === 0) {
    return null;
  }

  return (
    <div className="pending-order-ticker">
      <div className="pending-order-ticker__header">
        <span className="ticker-icon">🍕</span>
        <h3 className="ticker-title">Active Orders ({activeOrders.length})</h3>
      </div>
      <div className="pending-order-ticker__list">
        {activeOrders.slice(0, 3).map(order => (
          <div
            key={order.orderId}
            className="ticker-order"
            onClick={() => goToOrder(order.orderId)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                goToOrder(order.orderId);
              }
            }}
          >
            <div className="ticker-order__info">
              <div className="ticker-order__id">
                Order #{order.orderId.slice(-6).toUpperCase()}
              </div>
              <div className={`ticker-order__status ticker-order__status--${order.orderState}`}>
                {getOrderStateLabel(order.orderState)}
              </div>
            </div>
            <div className="ticker-order__action">
              <span className="ticker-order__link">View Order →</span>
            </div>
          </div>
        ))}
        {activeOrders.length > 3 && (
          <div className="ticker-order ticker-order--more">
            <span className="ticker-more-text">
              +{activeOrders.length - 3} more order{activeOrders.length - 3 === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="ticker-view-all"
              onClick={() => onNavigate('orders')}
            >
              View All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
