// SUNNYS Pizza — Admin Inventory Manager
// Read-only inventory overview

import { useEffect, useState } from 'react';
import * as adminApi from '../api/admin.js';

// Format paise to rupees
function formatRupees(paise) {
  if (typeof paise !== 'number' || isNaN(paise)) return '—';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Get category display name
function getCategoryLabel(category) {
  const labels = {
    base: 'Base',
    sauce: 'Sauce',
    cheese: 'Cheese',
    vegetable: 'Vegetable',
    protein: 'Protein'
  };
  return labels[category] || category;
}

// Get stock status
function getStockStatus(ingredient) {
  if (!ingredient.isActive) return 'inactive';
  if (ingredient.available <= 0) return 'out';
  if (ingredient.available <= ingredient.lowStockThreshold) return 'low';
  return 'in-stock';
}

// Get stock status label
function getStockStatusLabel(status) {
  const labels = {
    'in-stock': 'In Stock',
    'low': 'Low Stock',
    'out': 'Out of Stock',
    'inactive': 'Inactive'
  };
  return labels[status] || status;
}

// Ingredient Row Component
function IngredientRow({ ingredient, onUpdateStock, onUpdateThreshold }) {
  const status = getStockStatus(ingredient);
  
  return (
    <tr className={`inventory-row inventory-row--${status}`}>
      <td className="inventory-cell inventory-cell--name">
        <div className="ingredient-name-wrapper">
          <span className="ingredient-name">{ingredient.name}</span>
          {!ingredient.isActive && (
            <span className="inactive-badge">Inactive</span>
          )}
        </div>
      </td>
      <td className="inventory-cell inventory-cell--category">
        <span className={`category-pill category-pill--${ingredient.category}`}>
          {getCategoryLabel(ingredient.category)}
        </span>
      </td>
      <td className="inventory-cell inventory-cell--number">
        {formatRupees(ingredient.pricePaise)}
      </td>
      <td className="inventory-cell inventory-cell--number">
        {ingredient.stock}
      </td>
      <td className="inventory-cell inventory-cell--number">
        {ingredient.reserved}
      </td>
      <td className="inventory-cell inventory-cell--number inventory-cell--available">
        <span className={`available-value available-value--${status}`}>
          {ingredient.available}
        </span>
      </td>
      <td className="inventory-cell inventory-cell--number">
        <button
          className="threshold-button"
          onClick={() => onUpdateThreshold(ingredient)}
          title="Edit threshold"
        >
          {ingredient.lowStockThreshold}
        </button>
      </td>
      <td className="inventory-cell inventory-cell--status">
        <span className={`status-pill status-pill--${status}`}>
          {getStockStatusLabel(status)}
        </span>
      </td>
      <td className="inventory-cell inventory-cell--actions">
        <button
          className="button button--small button--secondary"
          onClick={() => onUpdateStock(ingredient)}
          title="Update stock"
        >
          Update
        </button>
      </td>
    </tr>
  );
}

// Update Stock Modal Component
function UpdateStockModal({ ingredient, onSave, onCancel, csrfToken }) {
  const [newStock, setNewStock] = useState(ingredient.stock);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const minStock = ingredient.reserved;
  const newAvailable = newStock - ingredient.reserved;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate
    if (newStock < minStock) {
      setError(`Stock cannot be less than reserved quantity (${minStock})`);
      return;
    }

    if (!Number.isInteger(newStock) || newStock < 0) {
      setError('Stock must be a non-negative integer');
      return;
    }

    if (!csrfToken) {
      setError('Security token missing. Please refresh the page.');
      return;
    }

    try {
      setSaving(true);
      await onSave(ingredient.id, newStock);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-content--small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Update Stock</h2>
          <button 
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
            disabled={saving}
          >
            ×
          </button>
        </div>

        <form className="stock-update-form" onSubmit={handleSubmit}>
          <div className="stock-update-info">
            <h3>{ingredient.name}</h3>
            <span className={`category-pill category-pill--${ingredient.category}`}>
              {getCategoryLabel(ingredient.category)}
            </span>
          </div>

          <div className="stock-update-current">
            <div className="stock-info-item">
              <span className="stock-info-label">Current Total Stock:</span>
              <span className="stock-info-value">{ingredient.stock}</span>
            </div>
            <div className="stock-info-item">
              <span className="stock-info-label">Reserved:</span>
              <span className="stock-info-value">{ingredient.reserved}</span>
            </div>
            <div className="stock-info-item">
              <span className="stock-info-label">Currently Available:</span>
              <span className="stock-info-value">{ingredient.available}</span>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="new-stock">New Total Stock *</label>
            <input
              id="new-stock"
              type="number"
              min={minStock}
              step="1"
              value={newStock}
              onChange={(e) => setNewStock(parseInt(e.target.value, 10) || 0)}
              disabled={saving}
              required
              autoFocus
            />
            <p className="form-help">
              Minimum: {minStock} (cannot be less than reserved)
            </p>
          </div>

          <div className="stock-update-preview">
            <div className="stock-info-item stock-info-item--highlight">
              <span className="stock-info-label">New Available:</span>
              <span className={`stock-info-value ${newAvailable < ingredient.lowStockThreshold ? 'text-warning' : 'text-success'}`}>
                {newAvailable}
              </span>
            </div>
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={saving || newStock === ingredient.stock}
            >
              {saving ? 'Saving...' : 'Save Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Update Threshold Modal Component
function UpdateThresholdModal({ ingredient, onSave, onCancel, csrfToken }) {
  const [newThreshold, setNewThreshold] = useState(ingredient.lowStockThreshold);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const available = ingredient.stock - ingredient.reserved;
  const wouldBeLowStock = available <= newThreshold;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate
    if (!Number.isInteger(newThreshold) || newThreshold < 0) {
      setError('Threshold must be a non-negative integer');
      return;
    }

    if (!csrfToken) {
      setError('Security token missing. Please refresh the page.');
      return;
    }

    try {
      setSaving(true);
      await onSave(ingredient.id, newThreshold);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-content--small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Update Low-Stock Threshold</h2>
          <button 
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
            disabled={saving}
          >
            ×
          </button>
        </div>

        <form className="stock-update-form" onSubmit={handleSubmit}>
          <div className="stock-update-info">
            <h3>{ingredient.name}</h3>
            <span className={`category-pill category-pill--${ingredient.category}`}>
              {getCategoryLabel(ingredient.category)}
            </span>
          </div>

          <div className="stock-update-current">
            <div className="stock-info-item">
              <span className="stock-info-label">Total Stock:</span>
              <span className="stock-info-value">{ingredient.stock}</span>
            </div>
            <div className="stock-info-item">
              <span className="stock-info-label">Reserved:</span>
              <span className="stock-info-value">{ingredient.reserved}</span>
            </div>
            <div className="stock-info-item">
              <span className="stock-info-label">Available:</span>
              <span className="stock-info-value">{available}</span>
            </div>
            <div className="stock-info-item">
              <span className="stock-info-label">Current Threshold:</span>
              <span className="stock-info-value">{ingredient.lowStockThreshold}</span>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="new-threshold">New Alert Threshold *</label>
            <input
              id="new-threshold"
              type="number"
              min="0"
              step="1"
              value={newThreshold}
              onChange={(e) => setNewThreshold(parseInt(e.target.value, 10) || 0)}
              disabled={saving}
              required
              autoFocus
            />
            <p className="form-help">
              Alert when available quantity drops to or below this value
            </p>
          </div>

          <div className="stock-update-preview">
            <div className="stock-info-item stock-info-item--highlight">
              <span className="stock-info-label">Current Status:</span>
              <span className={`stock-info-value ${wouldBeLowStock ? 'text-warning' : 'text-success'}`}>
                {wouldBeLowStock ? `Low Stock (${available} ≤ ${newThreshold})` : `In Stock (${available} > ${newThreshold})`}
              </span>
            </div>
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={saving || newThreshold === ingredient.lowStockThreshold}
            >
              {saving ? 'Saving...' : 'Save Threshold'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InventoryManager({ user, onNavigate, csrfToken }) {
  const [ingredients, setIngredients] = useState([]);
  const [filteredIngredients, setFilteredIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');

  // Update stock modal
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updatingIngredient, setUpdatingIngredient] = useState(null);

  // Update threshold modal
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [updatingThreshold, setUpdatingThreshold] = useState(null);

  // Authorization check
  

  // Fetch ingredients
useEffect(() => {
  // Only fetch inventory for authenticated admins
  if (user?.role !== 'admin') return;

  let mounted = true;

    async function loadIngredients() {
      try {
        setLoading(true);
        setError(null);
        const data = await adminApi.getIngredients();
        
        if (mounted) {
          setIngredients(data);
          setFilteredIngredients(data);
        }
      } catch (err) {
        if (mounted) {
          console.error('Failed to load ingredients:', err);
          setError(err.message || 'Failed to load ingredients');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadIngredients();

    return () => {
      mounted = false;
    };
  }, [user?.role]);

  // Apply filters
  useEffect(() => {
    let result = ingredients;

    // Category filter
    if (categoryFilter !== 'all') {
      result = result.filter(ing => ing.category === categoryFilter);
    }

    // Stock status filter
    if (stockFilter !== 'all') {
      result = result.filter(ing => {
        if (!ing.isActive) return false; // Inactive filtered separately
        const status = getStockStatus(ing);
        return status === stockFilter;
      });
    }

    // Active/inactive filter
    if (activeFilter !== 'all') {
      const shouldBeActive = activeFilter === 'active';
      result = result.filter(ing => ing.isActive === shouldBeActive);
    }

    // Search filter
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      result = result.filter(ing => 
        ing.name.toLowerCase().includes(search)
      );
    }

    setFilteredIngredients(result);
  }, [ingredients, searchTerm, categoryFilter, stockFilter, activeFilter]);

  // Handle update stock modal
  const handleUpdateStock = (ingredient) => {
    setUpdatingIngredient(ingredient);
    setShowUpdateModal(true);
  };

  // Handle stock save
  const handleStockSave = async (ingredientId, newStock) => {
    try {
      await adminApi.updateIngredientStock(ingredientId, newStock, csrfToken);
      
      // Reload ingredients to get fresh data
      const data = await adminApi.getIngredients();
      setIngredients(data);
      
      // Close modal
      setShowUpdateModal(false);
      setUpdatingIngredient(null);
    } catch (err) {
      // Error is handled in modal
      throw err;
    }
  };

  // Handle modal close
  const handleModalClose = () => {
    setShowUpdateModal(false);
    setUpdatingIngredient(null);
  };

  // Handle update threshold modal
  const handleUpdateThreshold = (ingredient) => {
    setUpdatingThreshold(ingredient);
    setShowThresholdModal(true);
  };

  // Handle threshold save
  const handleThresholdSave = async (ingredientId, newThreshold) => {
    try {
      await adminApi.updateIngredientThreshold(ingredientId, newThreshold, csrfToken);
      
      // Reload ingredients to get fresh data
      const data = await adminApi.getIngredients();
      setIngredients(data);
      
      // Close modal
      setShowThresholdModal(false);
      setUpdatingThreshold(null);
    } catch (err) {
      // Error is handled in modal
      throw err;
    }
  };

  // Handle threshold modal close
  const handleThresholdModalClose = () => {
    setShowThresholdModal(false);
    setUpdatingThreshold(null);
  };

  // Calculate summary statistics
  const stats = {
    total: ingredients.length,
    active: ingredients.filter(ing => ing.isActive).length,
    lowStock: ingredients.filter(ing => ing.isActive && ing.available > 0 && ing.available <= ing.lowStockThreshold).length,
    outOfStock: ingredients.filter(ing => ing.isActive && ing.available <= 0).length
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="admin-content">
        <div className="admin-content__error">
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

  // Loading state
  if (loading) {
    return (
      <div className="admin-content">
        <div className="admin-content__header">
          <h1>Inventory Management</h1>
        </div>
        <div className="admin-content__loading">
          <div className="spinner" aria-label="Loading inventory" />
          <p>Loading inventory...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="admin-content">
        <div className="admin-content__header">
          <h1>Inventory Management</h1>
        </div>
        <div className="admin-content__error">
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

  return (
    <div className="admin-content">
      <div className="admin-content__header">
        <h1>Inventory Management</h1>
        <p className="admin-content__subtitle">
          Overview of ingredient stock and availability
        </p>
      </div>

      {/* Summary Cards */}
      <div className="inventory-stats">
        <div className="stat-card">
          <div className="stat-card__label">Total Ingredients</div>
          <div className="stat-card__value">{stats.total}</div>
        </div>
        <div className="stat-card stat-card--success">
          <div className="stat-card__label">Active</div>
          <div className="stat-card__value">{stats.active}</div>
        </div>
        <div className="stat-card stat-card--warning">
          <div className="stat-card__label">Low Stock</div>
          <div className="stat-card__value">{stats.lowStock}</div>
        </div>
        <div className="stat-card stat-card--danger">
          <div className="stat-card__label">Out of Stock</div>
          <div className="stat-card__value">{stats.outOfStock}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="inventory-filters">
        <div className="filter-group">
          <label htmlFor="search">Search:</label>
          <input
            id="search"
            type="text"
            className="filter-input"
            placeholder="Search by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="category">Category:</label>
          <select
            id="category"
            className="filter-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All Categories</option>
            <option value="base">Base</option>
            <option value="sauce">Sauce</option>
            <option value="cheese">Cheese</option>
            <option value="vegetable">Vegetable</option>
            <option value="protein">Protein</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="stock-status">Stock Status:</label>
          <select
            id="stock-status"
            className="filter-select"
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="in-stock">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="active-status">Availability:</label>
          <select
            id="active-status"
            className="filter-select"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Results Count */}
      {(searchTerm || categoryFilter !== 'all' || stockFilter !== 'all' || activeFilter !== 'all') && (
        <div className="filter-results">
          Showing {filteredIngredients.length} of {ingredients.length} ingredients
        </div>
      )}

      {/* Inventory Table */}
      {filteredIngredients.length === 0 ? (
        <div className="admin-content__empty">
          <p>No ingredients found matching your filters.</p>
        </div>
      ) : (
        <div className="inventory-table-wrapper">
          <table className="inventory-table">
            <thead>
              <tr>
                <th className="inventory-header">Name</th>
                <th className="inventory-header">Category</th>
                <th className="inventory-header">Price</th>
                <th className="inventory-header">Stock</th>
                <th className="inventory-header">Reserved</th>
                <th className="inventory-header">Available</th>
                <th className="inventory-header">Threshold</th>
                <th className="inventory-header">Status</th>
                <th className="inventory-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredIngredients.map(ingredient => (
                <IngredientRow 
                  key={ingredient.id} 
                  ingredient={ingredient}
                  onUpdateStock={handleUpdateStock}
                  onUpdateThreshold={handleUpdateThreshold}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Update Stock Modal */}
      {showUpdateModal && updatingIngredient && (
        <UpdateStockModal
          ingredient={updatingIngredient}
          onSave={handleStockSave}
          onCancel={handleModalClose}
          csrfToken={csrfToken}
        />
      )}

      {/* Update Threshold Modal */}
      {showThresholdModal && updatingThreshold && (
        <UpdateThresholdModal
          ingredient={updatingThreshold}
          onSave={handleThresholdSave}
          onCancel={handleThresholdModalClose}
          csrfToken={csrfToken}
        />
      )}
    </div>
  );
}
