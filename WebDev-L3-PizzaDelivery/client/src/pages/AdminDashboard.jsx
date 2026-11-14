// SUNNYS Pizza — Admin Dashboard
// Requires administrator authentication (role === 'admin')

import { useEffect, useState } from 'react';
import * as adminApi from '../api/admin.js';

// Format paise to rupees display
function formatRupees(paise) {
  if (typeof paise !== 'number' || isNaN(paise)) return '₹0.00';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format timestamp to readable date
function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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

// StatCard Component
function StatCard({ icon, label, value, variant = 'default' }) {
  return (
    <div className={`stat-card stat-card--${variant}`}>
      <div className="stat-card__icon" aria-hidden="true">{icon}</div>
      <div className="stat-card__content">
        <div className="stat-card__label">{label}</div>
        <div className="stat-card__value">{value}</div>
      </div>
    </div>
  );
}

// RecentOrderCard Component
function RecentOrderCard({ order }) {
  return (
    <div className="recent-order-card">
      <div className="recent-order-card__header">
        <span className="recent-order-card__id" title={`Order ID: ${order.orderId}`}>
          #{order.orderId.slice(-6)}
        </span>
        <span className={`order-badge order-badge--${order.orderState}`}>
          {getOrderStateLabel(order.orderState)}
        </span>
      </div>
      <div className="recent-order-card__body">
        <div className="recent-order-card__info">
          <span className="recent-order-card__label">Customer</span>
          <span className="recent-order-card__value">{order.customerEmail}</span>
        </div>
        <div className="recent-order-card__info">
          <span className="recent-order-card__label">Amount</span>
          <span className="recent-order-card__value">{formatRupees(order.totalPricePaise)}</span>
        </div>
        <div className="recent-order-card__info">
          <span className="recent-order-card__label">Date</span>
          <span className="recent-order-card__value">{formatDate(order.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}


export function AdminDashboard({ user, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch dashboard data
  useEffect(() => {
    // Only fetch data for authenticated administrators
    if (user?.role !== 'admin') {
      return;
    }

    let mounted = true;

    async function fetchDashboardData() {
      try {
        setLoading(true);
        setError(null);

        const [statsData, ordersData] = await Promise.all([
          adminApi.getDashboardStats(),
          adminApi.getRecentOrders(10)
        ]);

        if (mounted) {
          setStats(statsData);
          setOrders(ordersData.orders || []);
        }
      } catch (err) {
        if (mounted) {
          console.error('Failed to fetch dashboard data:', err);
          setError(err.message || 'Failed to load dashboard data');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchDashboardData();

    return () => {
      mounted = false;
    };
  }, [user?.role]); // Re-fetch when user changes or component mounts

  // Authorization check
  if (!user || user.role !== 'admin') {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__error">
          <h2>Access Denied</h2>
          <p>You must be an administrator to view this page.</p>
          <button
            className="button button--primary"
            onClick={() => onNavigate('home')}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // Loading state continues below

  // Loading state
  if (loading) {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__header">
          <h1>Admin Dashboard</h1>
        </div>
        <div className="admin-dashboard__loading">
          <div className="spinner" aria-label="Loading dashboard data" />
          <p>Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__header">
          <h1>Admin Dashboard</h1>
        </div>
        <div className="admin-dashboard__error">
          <p>{error}</p>
          <button 
            className="button button--primary" 
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state (unlikely but handled)
  if (!stats) {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__header">
          <h1>Admin Dashboard</h1>
        </div>
        <div className="admin-dashboard__empty">
          <p>No dashboard data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__header">
        <h1>Admin Dashboard</h1>
        <p className="admin-dashboard__subtitle">Overview of orders, inventory, and pizzas</p>
      </div>

      {/* Statistics Grid */}
      <div className="stats-grid">
        <StatCard 
          icon="📦"
          label="Total Orders"
          value={stats.totalOrders}
          variant="default"
        />
        <StatCard 
          icon="💰"
          label="Total Revenue"
          value={formatRupees(stats.totalRevenue)}
          variant="success"
        />
        <StatCard 
          icon="⏳"
          label="Pending Payment"
          value={stats.pendingPaymentOrders}
          variant="warning"
        />
        <StatCard 
          icon="🔥"
          label="Active Orders"
          value={stats.activeOrders}
          variant="info"
        />
        <StatCard 
          icon="⚠️"
          label="Low Stock Items"
          value={stats.lowStockCount}
          variant={stats.lowStockCount > 0 ? 'danger' : 'default'}
        />
        <StatCard 
          icon="🍕"
          label="Active Pizzas"
          value={stats.activePizzas}
          variant="default"
        />
      </div>

      {/* Recent Orders Section */}
      <div className="admin-dashboard__section">
        <h2>Recent Orders</h2>
        {orders.length === 0 ? (
          <div className="admin-dashboard__empty">
            <p>No orders found.</p>
          </div>
        ) : (
          <div className="recent-orders-grid">
            {orders.map(order => (
              <RecentOrderCard key={order.orderId} order={order} />
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions Section */}
      <div className="admin-dashboard__section">
        <h2>Management</h2>
        <div className="quick-actions-grid">
          <button
            className="quick-action-card"
            onClick={() => onNavigate('admin/orders')}
          >
            <span className="quick-action-card__icon" aria-hidden="true">📋</span>
            <h3>Manage Orders</h3>
            <p>View and update order status</p>
          </button>

          <button
            className="quick-action-card"
            onClick={() => onNavigate('admin/pizzas')}
          >
            <span className="quick-action-card__icon" aria-hidden="true">🍕</span>
            <h3>Manage Pizzas</h3>
            <p>View and manage the pizza catalogue</p>
          </button>
          
          <button
            className="quick-action-card"
            onClick={() => onNavigate('admin/inventory')}
          >
            <span className="quick-action-card__icon" aria-hidden="true">📦</span>
            <h3>Inventory Overview</h3>
            <p>Monitor ingredient stock levels</p>
          </button>
        </div>
      </div>
    </div>
  );
}
