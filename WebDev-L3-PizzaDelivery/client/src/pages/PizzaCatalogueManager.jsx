// SUNNYS Pizza — Admin Pizza Catalogue Manager
// Displays all pizzas with filtering and search
import { useEffect, useState } from 'react';

import * as adminApi from '../api/admin.js';

import { PizzaForm } from '../components/PizzaForm.jsx';

// Format paise to rupees
function formatRupees(paise) {

  if (typeof paise !== 'number' || isNaN(paise)) return '—';

  const rupees = paise / 100;

  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

}

// Category badge mapping
function getCategoryBadge(category) {

  const badges = {

    vegetarian: { label: 'Vegetarian', className: 'badge-vegetarian' },

    vegan: { label: 'Vegan', className: 'badge-vegan' },

    'non-vegetarian': { label: 'Non-Vegetarian', className: 'badge-non-veg' }

  };

  return badges[category] || { label: category, className: 'badge-default' };

}

// Pizza Card Component
function PizzaCard({ pizza, onEdit, onToggleStatus, statusChanging }) {

  const badge = getCategoryBadge(pizza.category);

  const isChangingStatus = statusChanging === pizza.id;

  // Build ingredients display
  const ingredientsList = [];

  if (pizza.ingredients?.base) ingredientsList.push(pizza.ingredients.base.name);

  if (pizza.ingredients?.sauce) ingredientsList.push(pizza.ingredients.sauce.name);

  if (pizza.ingredients?.cheese) ingredientsList.push(pizza.ingredients.cheese.name);

  if (pizza.ingredients?.vegetables?.length > 0) {

    ingredientsList.push(...pizza.ingredients.vegetables.map(v => v.name));

  }

  if (pizza.ingredients?.proteins?.length > 0) {

    ingredientsList.push(...pizza.ingredients.proteins.map(p => p.name));

  }

  return (

    <div className={`pizza-admin-card ${!pizza.isActive ? 'pizza-admin-card--inactive' : ''}`}>

      {!pizza.isActive && <div className="pizza-admin-card__inactive-badge">INACTIVE</div>}

      <div className="pizza-admin-card__header">

        <h3 className="pizza-admin-card__name">{pizza.name}</h3>

        <span className={`category-badge ${badge.className}`}>{badge.label}</span>

      </div>

      {pizza.description && (

        <p className="pizza-admin-card__description">{pizza.description}</p>

      )}

      <div className="pizza-admin-card__ingredients">

        <h4>Ingredients:</h4>

        <p>{ingredientsList.join(', ')}</p>

      </div>

      <div className="pizza-admin-card__footer">

        <div className="pizza-admin-card__price">

          <span className="price-label">Price:</span>

          <span className="price-value">{formatRupees(pizza.pricePaise)}</span>

        </div>

        <div className="pizza-admin-card__status">

          <span className={`status-indicator ${pizza.isActive ? 'status-active' : 'status-inactive'}`}>

            {pizza.isActive ? 'Active' : 'Inactive'}

          </span>

        </div>

      </div>

      {pizza.imageUrl && (

        <div className="pizza-admin-card__image-indicator">

          <span>📷 Image available</span>

        </div>

      )}

      <div className="pizza-admin-card__actions">

        <button 

          className="button button--secondary button--small"

          onClick={() => onEdit(pizza)}

          disabled={isChangingStatus}

        >

          Edit

        </button>

        <button 

          className={`button button--small ${pizza.isActive ? 'button--warning' : 'button--success'}`}

          onClick={() => onToggleStatus(pizza)}

          disabled={isChangingStatus}

        >

          {isChangingStatus ? 'Processing...' : (pizza.isActive ? 'Deactivate' : 'Activate')}

        </button>

      </div>

    </div>

  );

}

export function PizzaCatalogueManager({

  user,

  onNavigate,

  csrfToken

}) {

  const [pizzas, setPizzas] = useState([]);

  const [filteredPizzas, setFilteredPizzas] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');

  const [categoryFilter, setCategoryFilter] = useState('all');

  const [showForm, setShowForm] = useState(false);

  const [editingPizza, setEditingPizza] = useState(null);

  const [statusChanging, setStatusChanging] = useState(null);

  const [statusMessage, setStatusMessage] = useState(null);

  // Fetch pizzas
  useEffect(() => {

    let mounted = true;

    async function loadPizzas() {

      try {

        setLoading(true);

        setError(null);

        const data = await adminApi.getAllPizzas();

if (user?.role !== 'admin') return;

        if (mounted) {

          setPizzas(data);

          setFilteredPizzas(data);

        }

      } catch (err) {

        if (mounted) {

          console.error('Failed to load pizzas:', err);

          setError(err.message || 'Failed to load pizzas');

        }

      } finally {

        if (mounted) {

          setLoading(false);

        }

      }

    }

    loadPizzas();

    return () => {

      mounted = false;

    };

 }, [user?.role]);

  // Apply filters
  useEffect(() => {

    let result = pizzas;

    // Category filter
    if (categoryFilter !== 'all') {

      result = result.filter(p => p.category === categoryFilter);

    }

    // Search filter
    if (searchTerm.trim()) {

      const search = searchTerm.toLowerCase();

      result = result.filter(p => 

        p.name.toLowerCase().includes(search) ||

        p.description?.toLowerCase().includes(search)

      );

    }

    setFilteredPizzas(result);

  }, [pizzas, searchTerm, categoryFilter]);

  // Handle add pizza
  function handleAddPizza() {

    setEditingPizza(null);

    setShowForm(true);

  }

  // Handle edit pizza
  function handleEditPizza(pizza) {

    setEditingPizza(pizza);

    setShowForm(true);

  }

  // Handle form close
  function handleFormClose() {

    setShowForm(false);

    setEditingPizza(null);

  }

  // Handle form success (including non-fatal image upload failures)
  async function handleFormSuccess({ warning } = {}) {

    setShowForm(false);

    setEditingPizza(null);

    setStatusMessage(warning
      ? { type: 'error', text: warning }
      : { type: 'success', text: 'Pizza saved successfully.' });

    // Reload pizzas
    try {

      setLoading(true);

      const data = await adminApi.getAllPizzas();

      setPizzas(data);

      setFilteredPizzas(data);

    } catch (err) {

      console.error('Failed to reload pizzas:', err);

      setError(err.message || 'Failed to reload pizzas');

    } finally {

      setLoading(false);

    }

  }

  // Handle toggle pizza status (activate/deactivate)
  async function handleToggleStatus(pizza) {

    const newStatus = !pizza.isActive;

    const action = newStatus ? 'activate' : 'deactivate';

    // Confirm deactivation
    if (!newStatus) {

      const confirmed = window.confirm(

        `Are you sure you want to deactivate "${pizza.name}"?\n\nThis pizza will no longer be available to customers.`

      );

      if (!confirmed) return;

    }

    try {

      setStatusChanging(pizza.id);

      setStatusMessage(null);

      await adminApi.updatePizzaStatus(pizza.id, newStatus, csrfToken);

      // Update pizzas list locally
      const updatedPizzas = pizzas.map(p => 

        p.id === pizza.id ? { ...p, isActive: newStatus } : p

      );

      setPizzas(updatedPizzas);

      // Reapply filters to update filtered list
      let result = updatedPizzas;

      if (categoryFilter !== 'all') {

        result = result.filter(p => p.category === categoryFilter);

      }

      if (searchTerm.trim()) {

        const search = searchTerm.toLowerCase();

        result = result.filter(p => 

          p.name.toLowerCase().includes(search) ||

          p.description?.toLowerCase().includes(search)

        );

      }

      setFilteredPizzas(result);

      setStatusMessage({

        type: 'success',

        text: `Pizza "${pizza.name}" ${action}d successfully`

      });

      // Clear success message after 3 seconds
      setTimeout(() => setStatusMessage(null), 3000);

    } catch (err) {

      console.error(`Failed to ${action} pizza:`, err);

      setStatusMessage({

        type: 'error',

        text: err.message || `Failed to ${action} pizza`

      });

    } finally {

      setStatusChanging(null);

    }

  }

  // Authorization check
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

          <h1>Pizza Catalogue Management</h1>

        </div>

        <div className="admin-content__loading">

          <div className="spinner" aria-label="Loading pizzas" />

          <p>Loading pizza catalogue...</p>

        </div>

      </div>

    );

  }

  // Error state
  if (error) {

    return (

      <div className="admin-content">

        <div className="admin-content__header">

          <h1>Pizza Catalogue Management</h1>

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

        <div>

          <h1>Pizza Catalogue Management</h1>

          <p className="admin-content__subtitle">

            Total: {pizzas.length} pizzas ({pizzas.filter(p => p.isActive).length} active, {pizzas.filter(p => !p.isActive).length} inactive)

          </p>

        </div>

        <button 

          className="button button--primary"

          onClick={handleAddPizza}

        >

          Add Pizza

        </button>

      </div>

      {/* Filters */}

      <div className="catalogue-filters">

        <div className="filter-group">

          <label htmlFor="search">Search:</label>

          <input

            id="search"

            type="text"

            className="filter-input"

            placeholder="Search by name or description..."

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

            <option value="vegetarian">Vegetarian</option>

            <option value="vegan">Vegan</option>

            <option value="non-vegetarian">Non-Vegetarian</option>

          </select>

        </div>

      </div>

      {/* Status Message */}

      {statusMessage && (

        <div className={`status-message status-message--${statusMessage.type}`}>

          {statusMessage.text}

        </div>

      )}

      {/* Results Count */}

      {(searchTerm || categoryFilter !== 'all') && (

        <div className="filter-results">

          Showing {filteredPizzas.length} of {pizzas.length} pizzas

        </div>

      )}

      {/* Pizza Grid */}

      {filteredPizzas.length === 0 ? (

        <div className="admin-content__empty">

          <p>No pizzas found matching your filters.</p>

        </div>

      ) : (

        <div className="pizza-admin-grid">

          {filteredPizzas.map(pizza => (

            <PizzaCard 

              key={pizza.id} 

              pizza={pizza} 

              onEdit={handleEditPizza} 

              onToggleStatus={handleToggleStatus}

              statusChanging={statusChanging}

            />

          ))}

        </div>

      )}

      {/* Pizza Form Modal */}

      {showForm && (

        <div className="modal-overlay" onClick={handleFormClose}>

          <div className="modal-content" onClick={(e) => e.stopPropagation()}>

            <div className="modal-header">

              <h2>{editingPizza ? 'Edit Pizza' : 'Add New Pizza'}</h2>

              <button 

                className="modal-close"

                onClick={handleFormClose}

                aria-label="Close"

              >

                ×

              </button>

            </div>

            <PizzaForm

  mode={editingPizza ? 'edit' : 'create'}

  pizza={editingPizza}

  onSave={handleFormSuccess}

  onCancel={handleFormClose}

  csrfToken={csrfToken}

/>

          </div>

        </div>

      )}

    </div>

  );

}
