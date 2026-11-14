import { useState, useEffect, forwardRef } from 'react';
import * as ordersApi from '../api/orders.js';
import { orderSocket } from '../realtime/socket.js';
import * as catalogueApi from '../api/catalogue.js';
import { useScrollAnimation } from '../hooks/useScrollAnimation.js';
import { useOrderPolling, detectOrderTransition } from '../hooks/useOrderPolling.js';

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PizzaIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <circle cx="8" cy="10" r="1.5" fill="currentColor"/>
      <circle cx="14" cy="9" r="1.5" fill="currentColor"/>
      <circle cx="10" cy="14" r="1.5" fill="currentColor"/>
      <circle cx="15" cy="14" r="1.5" fill="currentColor"/>
      <path d="M12 2 L16 8 L12 12 L8 8 Z" fill="currentColor" opacity="0.3"/>
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2L2 20h20L12 2z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// Map backend order states to customer-friendly display
function getOrderStatusDisplay(orderState, paymentStatus) {
  if (orderState === 'pending_payment') {
    return {
      label: 'Payment Pending',
      class: 'status--warning',
      description: 'Awaiting payment confirmation',
      cardClass: 'order-card--pending'
    };
  }
  
  if (orderState === 'expired') {
    return {
      label: 'Expired',
      class: 'status--error',
      description: 'Order reservation expired',
      cardClass: 'order-card--expired'
    };
  }
  
  if (orderState === 'received') {
    return {
      label: 'Order Received',
      class: 'status--success',
      description: 'Your order has been received',
      cardClass: 'order-card--received'
    };
  }
  
  if (orderState === 'in_kitchen') {
    return {
      label: 'In Kitchen',
      class: 'status--active',
      description: 'Your pizzas are being prepared',
      cardClass: 'order-card--in-kitchen'
    };
  }
  
  if (orderState === 'sent_to_delivery') {
    return {
      label: 'Out for Delivery',
      class: 'status--delivery',
      description: 'Your order is on its way',
      cardClass: 'order-card--delivery'
    };
  }
  
  return {
    label: orderState,
    class: 'status--default',
    description: '',
    cardClass: ''
  };
}

const OrderCard = forwardRef(function OrderCard({ order, onViewDetails }, ref) {
  const status = getOrderStatusDisplay(order.orderState, order.paymentStatus);
  
  // Format order ID to be shorter (last 6 chars)
  const shortOrderId = order.orderId.slice(-6).toUpperCase();
  
  const orderDate = new Date(order.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  
  const orderTime = new Date(order.createdAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <article ref={ref} className={`order-card ${status.cardClass}`}>
      <div className="order-card__header">
        <span className={`order-status-badge ${status.class}`}>
          {status.label}
        </span>
      </div>

      <div className="order-card__body">
        <div className="order-card__meta">
          <h3 className="order-card__id">#{shortOrderId}</h3>
          <p className="order-card__date">{orderDate} • {orderTime}</p>
        </div>

        <div className="order-card__items">
          {order.items.slice(0, 2).map((item, index) => (
            <div key={index} className="order-card__item">
              <span className="item-name">{item.name}</span>
              <span className="item-qty">×{item.quantity}</span>
            </div>
          ))}
          {order.items.length > 2 && (
            <p className="order-card__more">
              +{order.items.length - 2} more
            </p>
          )}
        </div>
      </div>

      <div className="order-card__footer">
        <div className="order-card__price">
          <small>Total</small>
          <strong>{catalogueApi.formatPrice(order.totalPricePaise)}</strong>
        </div>
        <button
          type="button"
          className="order-card__button"
          onClick={() => onViewDetails(order.orderId)}
          aria-label={`View details for order ${shortOrderId}`}
        >
          View details <ArrowIcon />
        </button>
      </div>
    </article>
  );
});

function SkeletonCard() {
  return (
    <div className="order-card order-card--skeleton">
      <div className="order-card__header">
        <div className="skeleton skeleton--badge"></div>
      </div>
      <div className="order-card__body">
        <div className="order-card__meta">
          <div className="skeleton skeleton--title"></div>
          <div className="skeleton skeleton--text"></div>
        </div>
        <div className="order-card__items">
          <div className="skeleton skeleton--line"></div>
          <div className="skeleton skeleton--line"></div>
        </div>
      </div>
      <div className="order-card__footer">
        <div className="skeleton skeleton--price"></div>
        <div className="skeleton skeleton--button"></div>
      </div>
    </div>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const showPages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(showPages / 2));
  let endPage = Math.min(totalPages, startPage + showPages - 1);

  if (endPage - startPage < showPages - 1) {
    startPage = Math.max(1, endPage - showPages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <nav className="pagination" aria-label="Order history pagination">
      <button
        type="button"
        className="pagination__button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        ← Previous
      </button>

      <div className="pagination__pages">
        {startPage > 1 && (
          <>
            <button
              type="button"
              className="pagination__page"
              onClick={() => onPageChange(1)}
            >
              1
            </button>
            {startPage > 2 && <span className="pagination__ellipsis">...</span>}
          </>
        )}

        {pages.map(page => (
          <button
            key={page}
            type="button"
            className={`pagination__page ${page === currentPage ? 'pagination__page--active' : ''}`}
            onClick={() => onPageChange(page)}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        ))}

        {endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && <span className="pagination__ellipsis">...</span>}
            <button
              type="button"
              className="pagination__page"
              onClick={() => onPageChange(totalPages)}
            >
              {totalPages}
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        className="pagination__button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        Next →
      </button>
    </nav>
  );
}

export function OrderHistory({ onViewDetails, onNotice }) {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const setCardRef = useScrollAnimation(true);
  
  // Track previous order states for transition detection
  const [orderStates, setOrderStates] = useState({});

  // Fetch orders function for initial load
  async function fetchOrders() {
    setLoading(true);
    setError('');

    try {
      const result = await ordersApi.getOrders(currentPage, 10);
      setOrders(result.orders);
      setPagination(result.pagination);
      
      // Initialize order states
      const states = {};
      result.orders.forEach(order => {
        states[order.orderId] = order.orderState;
      });
      setOrderStates(states);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      setError(err.message || 'Failed to load orders');
      
      if (err.status === 401) {
        onNotice('Please sign in to view your orders');
      }
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch on mount or page change
  useEffect(() => {
    let active = true;

    if (active) {
      fetchOrders();
    }

    return () => {
      active = false;
    };
  }, [currentPage, refreshKey, onNotice]);

  // Polling for live updates (only when not loading initial data)
  const { data: polledData } = useOrderPolling(
    async () => {
      const result = await ordersApi.getOrders(currentPage, 10);
      return result.orders;
    },
    15000, // Poll every 15 seconds
    {
      enabled: !loading && orders.length > 0,
      onUpdate: (newOrders, oldOrders) => {
        // Detect transitions
        newOrders.forEach(newOrder => {
          const oldState = orderStates[newOrder.orderId];
          const newState = newOrder.orderState;
          
          if (oldState && oldState !== newState) {
            // Status changed!
            const statusLabels = {
              pending_payment: 'Payment Pending',
              received: 'Order Received',
              in_kitchen: 'In Kitchen',
              sent_to_delivery: 'Out for Delivery',
              expired: 'Expired'
            };
            
            onNotice(`Order #${newOrder.orderId.slice(-6)} status updated: ${statusLabels[newState] || newState}`);
          }
        });
        
        // Update orders and states
        setOrders(newOrders);
        const states = {};
        newOrders.forEach(order => {
          states[order.orderId] = order.orderState;
        });
        setOrderStates(states);
      }
    }
  );

  function handlePageChange(page) {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <main className="order-history-page shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Orders</h1>
          <p className="page-subtitle">Track your pizza orders and view order history</p>
        </div>
      </div>

      {loading && (
        <div className="order-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && error && (
        <div className="error-state">
          <div className="error-state__icon">
            <AlertIcon />
          </div>
          <h2>Unable to load orders</h2>
          <p>{error}</p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setCurrentPage(1);
              setError('');
              setRefreshKey(prev => prev + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">
            <PizzaIcon />
          </div>
          <h2>No orders yet</h2>
          <p>When you place an order, it will appear here</p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.hash = '#home'}
          >
            Explore menu
          </button>
        </div>
      )}

      {!loading && !error && orders.length > 0 && (
        <>
          <div className="order-grid">
            {orders.map((order, index) => (
              <OrderCard
                key={order.orderId}
                ref={setCardRef(index)}
                order={order}
                onViewDetails={onViewDetails}
              />
            ))}
          </div>

          {pagination && (
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
            />
          )}

          <div className="order-history-info">
            <p>
              Showing {orders.length} of {pagination?.total || 0} order{pagination?.total !== 1 ? 's' : ''}
            </p>
          </div>
        </>
      )}
    </main>
  );
}
