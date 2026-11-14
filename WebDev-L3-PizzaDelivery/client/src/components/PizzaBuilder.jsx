import { useState, useEffect, useId } from 'react';
import * as catalogueApi from '../api/catalogue.js';
import * as cartUtils from '../utils/cart.js';

function ingredientId(ref) {
  if (ref == null) return '';
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object') {
    const raw = ref.id ?? ref._id ?? ref;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw.toHexString === 'function') return raw.toHexString();
    const asString = String(raw);
    return asString === '[object Object]' ? '' : asString;
  }
  return String(ref);
}

function idsEqual(a, b) {
  const left = ingredientId(a);
  const right = ingredientId(b);
  return Boolean(left) && left === right;
}

function firstInStockId(items = []) {
  return items.find((item) => item.inStock)?.id ?? null;
}

function isSelectedInStock(list, id) {
  return (list || []).some((item) => idsEqual(item.id, id) && item.inStock);
}

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PizzaArt({ kind = 'supreme', className = '' }) {
  const uid = useId().replace(/:/g, '');
  const pepperoni = kind === 'pepperoni';
  const toppings = [
    [159, 140, 21], [274, 126, 19], [348, 183, 22], [175, 303, 20],
    [310, 306, 23], [235, 238, 17], [118, 225, 17], [378, 275, 13],
  ];
  return (
    <svg className={`pizza-art ${className}`} viewBox="0 0 500 500" role="img" aria-label="Illustration of a freshly baked pizza with colourful toppings">
      <defs>
        <radialGradient id={`${uid}crust`}><stop stopColor="#F9C35C" /><stop offset=".76" stopColor="#F0A744"/><stop offset="1" stopColor="#9B4D20"/></radialGradient>
        <radialGradient id={`${uid}cheese`}><stop stopColor="#FFE9A3" /><stop offset=".72" stopColor="#F6CB6B"/><stop offset="1" stopColor="#DC7D3F"/></radialGradient>
        <radialGradient id={`${uid}sauce`}><stop stopColor="#F36B39"/><stop offset="1" stopColor="#B73723"/></radialGradient>
        <filter id={`${uid}shadow`} x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="12"/></filter>
      </defs>
      <ellipse cx="254" cy="461" rx="204" ry="23" fill="#000" opacity=".35" filter={`url(#${uid}shadow)`}/>
      <circle cx="250" cy="245" r="219" fill={`url(#${uid}crust)`}/>
      <circle cx="250" cy="245" r="194" fill={`url(#${uid}sauce)`}/>
      <circle cx="250" cy="245" r="185" fill={`url(#${uid}cheese)`}/>
      <path d="M250 58V432M75 166L424 321M100 365L395 125M55 246H445" stroke="#C8793E" strokeWidth="3" opacity=".28"/>
      {toppings.map(([x, y, r], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={r + (pepperoni ? 5 : 0)} fill={pepperoni ? '#B6352D' : '#CB3D2F'} stroke="#F37C49" strokeWidth="4" />
          <circle cx={x - 6} cy={y - 5} r="3" fill="#F9B177" opacity=".75" />
          <circle cx={x + 7} cy={y + 7} r="2.5" fill="#A52F26" opacity=".65" />
        </g>
      ))}
      {!pepperoni && (
        <g fill="none" stroke="#398943" strokeWidth="10" strokeLinecap="round">
          <path d="M136 176q24-35 47 3"/><path d="M287 203q26-32 48 5"/><path d="M214 352q20-34 48-8"/><path d="M336 353q-7-42 27-49"/>
        </g>
      )}
      <g fill="none" stroke="#272422" strokeWidth="8">
        <circle cx="224" cy="156" r="10"/><circle cx="360" cy="238" r="10"/><circle cx="148" cy="258" r="10"/>
        <circle cx="276" cy="368" r="10"/><circle cx="312" cy="157" r="9"/>
      </g>
      <g fill="#2D8343">
        <ellipse cx="258" cy="100" rx="9" ry="18" transform="rotate(28 258 100)"/>
        <ellipse cx="266" cy="108" rx="8" ry="17" transform="rotate(-30 266 108)"/>
        <ellipse cx="195" cy="274" rx="8" ry="18" transform="rotate(-30 195 274)"/>
        <ellipse cx="205" cy="275" rx="8" ry="17" transform="rotate(29 205 275)"/>
      </g>
      <circle cx="250" cy="245" r="209" fill="none" stroke="#FFE39B" strokeWidth="5" opacity=".5" />
    </svg>
  );
}

function PizzaPreviewMedia({ pizza }) {
  const imageUrl = pizza?.imageUrl || '';

  const [view, setView] = useState({
    current: '',
    previous: '',
    phase: imageUrl ? 'loading' : 'fallback'
  });

  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let fadeTimer;
    let skeletonTimer;

    if (!imageUrl) {
      setView({
        current: '',
        previous: '',
        phase: 'fallback'
      });
      setShowSkeleton(false);
      return;
    }

    setView(prev => ({ ...prev, phase: 'loading' }));
    setShowSkeleton(false);

    // Avoid skeleton flashes for cached images.
    skeletonTimer = setTimeout(() => {
      if (!cancelled) setShowSkeleton(true);
    }, 120);

    const image = new Image();

    image.onload = () => {
      if (cancelled) return;

      setView(prev => ({
        current: imageUrl,
        previous:
          prev.current !== imageUrl ? prev.current : '',
        phase: 'ready'
      }));

      setShowSkeleton(false);

      fadeTimer = setTimeout(() => {
        if (!cancelled) {
          setView(prev => ({
            ...prev,
            previous: ''
          }));
        }
      }, 260);
    };

    image.onerror = () => {
      if (cancelled) return;

      setView({
        current: '',
        previous: '',
        phase: 'fallback'
      });

      setShowSkeleton(false);
    };

    image.src = imageUrl;

    return () => {
      cancelled = true;
      clearTimeout(skeletonTimer);
      clearTimeout(fadeTimer);
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl]);

  return (
    <div className="pizza-preview-media">
      {view.previous && (
        <img
          src={view.previous}
          alt=""
          aria-hidden="true"
          className="pizza-photo pizza-preview-media__previous"
        />
      )}

      {view.current && (
        <img
          key={view.current}
          src={view.current}
          alt={`${pizza?.name || 'Pizza'} preview`}
          className="pizza-photo pizza-preview-media__current"
        />
      )}

      {!view.current &&
        view.phase === 'loading' &&
        showSkeleton && (
          <div
            className="pizza-preview-skeleton"
            role="status"
            aria-label="Loading pizza image"
          />
        )}

      {!view.current && view.phase === 'fallback' && (
        <PizzaArt kind={pizza?.kind || 'supreme'} />
      )}
    </div>
  );
}

export function PizzaBuilder({
  pizza,
  onBack,
  csrfToken,
  onNotice,
  onCartUpdate,
  user
}) {
  const [ingredients, setIngredients] = useState(null);
  const [loadingIngredients, setLoadingIngredients] = useState(true);
  const [ingredientsError, setIngredientsError] = useState('');
  
  // Selected ingredients
  const [selectedBase, setSelectedBase] = useState(null);
  const [selectedSauce, setSelectedSauce] = useState(null);
  const [selectedCheese, setSelectedCheese] = useState(null);
 const [selectedVegetables, setSelectedVegetables] = useState([]);

const [selectedProteins, setSelectedProteins] = useState([]);

  const isNonVegetarian =
    pizza?.category === 'non-vegetarian' || pizza?.kind === 'non-vegetarian';

const [quantity, setQuantity] = useState(1);
  
  // Quote state
  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  

  // Load available ingredients
  useEffect(() => {
    async function fetchIngredients() {
      try {
        setLoadingIngredients(true);
        setIngredientsError('');
        const data = await catalogueApi.getIngredients();
        setIngredients(data);
        
        // Initialize selections from pizza if provided
        if (pizza && pizza.ingredients) {
          const baseId = ingredientId(pizza.ingredients.base);
          const sauceId = ingredientId(pizza.ingredients.sauce);
          const cheeseId = ingredientId(pizza.ingredients.cheese);
          const vegetableIds = (pizza.ingredients.vegetables || []).map(ingredientId);
          const pizzaIsNonVeg =
            pizza.category === 'non-vegetarian' || pizza.kind === 'non-vegetarian';

          const baseMatch = data.base.find(b => idsEqual(b.id, baseId) && b.inStock);
          const sauceMatch = data.sauce.find(s => idsEqual(s.id, sauceId) && s.inStock);
          const cheeseMatch = data.cheese.find(c => idsEqual(c.id, cheeseId) && c.inStock);

          setSelectedBase(baseMatch?.id ?? firstInStockId(data.base));
          setSelectedSauce(sauceMatch?.id ?? firstInStockId(data.sauce));
          setSelectedCheese(cheeseMatch?.id ?? firstInStockId(data.cheese));

          const availableVegIds = vegetableIds.filter(vId =>
            data.vegetable.some(v => idsEqual(v.id, vId) && v.inStock)
          );
          setSelectedVegetables(availableVegIds);

          const proteinIds = (pizza.ingredients.proteins || []).map(ingredientId);
          const availableProteinIds = proteinIds.filter(pId =>
            (data.protein || []).some(p => idsEqual(p.id, pId) && p.inStock)
          );
          setSelectedProteins(pizzaIsNonVeg ? availableProteinIds : []);
        } else {
          setSelectedBase(firstInStockId(data.base));
          setSelectedSauce(firstInStockId(data.sauce));
          setSelectedCheese(firstInStockId(data.cheese));
          setSelectedProteins([]);
        }
      } catch (err) {
        console.error('Failed to fetch ingredients:', err);
        setIngredientsError(err.message);
        onNotice(err.message);
      } finally {
        setLoadingIngredients(false);
      }
    }
    
    fetchIngredients();
  }, [pizza, onNotice]);

// Get quote when selections change
useEffect(() => {
  if (
    !ingredients ||
    !selectedBase ||
    !selectedSauce ||
    !selectedCheese ||
    !csrfToken ||
    (isNonVegetarian && selectedProteins.length === 0)
  ) {
    setQuote(null);
    setQuoteError('');
    setLoadingQuote(false);
    return;
  }

  const quoteReady =
    isSelectedInStock(ingredients?.base, selectedBase) &&
    isSelectedInStock(ingredients?.sauce, selectedSauce) &&
    isSelectedInStock(ingredients?.cheese, selectedCheese) &&
    selectedVegetables.every((id) => isSelectedInStock(ingredients?.vegetable, id)) &&
    (!isNonVegetarian ||
      selectedProteins.every((id) => isSelectedInStock(ingredients?.protein, id)));

  if (!quoteReady) {
    setQuote(null);
    setQuoteError('One or more selected ingredients are unavailable.');
    setLoadingQuote(false);
    return;
  }

  const controller = new AbortController();

  // Clear outdated pricing immediately
  setQuote(null);
  setQuoteError('');
  setLoadingQuote(true);

  // Debounce quote requests
  const timer = setTimeout(async () => {
    try {
      const lines = [{
        recipe: {
          base: ingredientId(selectedBase),
          sauce: ingredientId(selectedSauce),
          cheese: ingredientId(selectedCheese),
          vegetables: selectedVegetables.map(ingredientId).filter(Boolean),
          proteins: isNonVegetarian
            ? selectedProteins.map(ingredientId).filter(Boolean)
            : [],
        },
        quantity: quantity,
      }];

      const result = await catalogueApi.getQuote(
        lines,
        csrfToken,
        controller.signal
      );

      if (!controller.signal.aborted) {
        setQuote(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setQuoteError(err.message || 'Failed to calculate price');
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoadingQuote(false);
      }
    }
  }, 300);

  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}, [
  selectedBase,
  selectedSauce,
  selectedCheese,
  selectedVegetables,
  selectedProteins,
  isNonVegetarian,
  quantity,
  csrfToken,
  ingredients,
]);

  function handleAddToCart() {
    if (!selectedBase || !selectedSauce || !selectedCheese) {
      onNotice('Please select all required ingredients');
      return;
    }

    if (isNonVegetarian && selectedProteins.length === 0) {
      onNotice('Please select at least one protein topping for your non-vegetarian pizza.');
      return;
    }

    try {
      if (!cartUtils.getCartOwnerId(user)) {
        onNotice('Please sign in to add pizzas to your cart.');
        return;
      }

      const cart = cartUtils.loadCart(user);
      
      const cartItem = {
        name: pizza ? pizza.name : 'Custom Pizza',
        recipe: {
          base: ingredientId(selectedBase),
          sauce: ingredientId(selectedSauce),
          cheese: ingredientId(selectedCheese),
          vegetables: selectedVegetables.map(ingredientId).filter(Boolean),
          proteins: isNonVegetarian
            ? selectedProteins.map(ingredientId).filter(Boolean)
            : [],
        },
        quantity: quantity,
        pizzaId: pizza?.id || null,
      };
      
      const updatedCart = cartUtils.addToCart(cart, cartItem);
      if (!cartUtils.saveCart(updatedCart, user)) {
        throw new Error('Failed to save cart.');
      }
      
      onNotice(`Added ${quantity} ${cartItem.name} to cart!`);
      
      // Notify parent to update cart count
      if (onCartUpdate) {
        onCartUpdate();
      }
      
      // Return to catalogue after adding
      onBack();
    } catch (err) {
      onNotice(err.message);
    }
  }

  function handleVegetableToggle(vegetableId) {
    setSelectedVegetables(prev => {
      if (prev.includes(vegetableId)) {
        return prev.filter(id => id !== vegetableId);
      } else {
        return [...prev, vegetableId];
      }
    });
  }

function handleProteinToggle(proteinId) {
  setSelectedProteins(prev => {
    if (prev.includes(proteinId)) {
      return prev.filter(id => id !== proteinId);
    }

    return [...prev, proteinId];
  });
}

  if (loadingIngredients) {
    return (
      <main className="builder-page shell">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <p>Loading pizza builder...</p>
        </div>
      </main>
    );
  }

  if (ingredientsError || !ingredients) {
    return (
      <main className="builder-page shell">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ color: 'var(--orange)', marginBottom: '20px' }}>
            {ingredientsError || 'Failed to load ingredients'}
          </p>
          <button type="button" className="button button--primary" onClick={onBack}>
            ← Back to menu
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="builder-page shell">
      <div className="builder-header">
        <button type="button" onClick={onBack} className="back-link">
          ← Back to menu
        </button>
        <h1 className="builder-title">
          {pizza ? pizza.name : 'Build Your Pizza'}
        </h1>
        {pizza && pizza.description && (
          <p className="builder-subtitle">{pizza.description}</p>
        )}
      </div>

      <div className="builder-layout">
        {/* Pizza Preview */}
        <div className="builder-preview">
          <div className="builder-preview__card">
  <PizzaPreviewMedia pizza={pizza} />
</div>
          
          <div className="builder-summary">
            <h3>Your Selection</h3>
            <div className="summary-list">
              {selectedBase && ingredients.base.find(b => b.id === selectedBase) && (
                <div className="summary-item">
                  <span className="summary-label">Base:</span>
                  <span>{ingredients.base.find(b => b.id === selectedBase).name}</span>
                </div>
              )}
              {selectedSauce && ingredients.sauce.find(s => s.id === selectedSauce) && (
                <div className="summary-item">
                  <span className="summary-label">Sauce:</span>
                  <span>{ingredients.sauce.find(s => s.id === selectedSauce).name}</span>
                </div>
              )}
              {selectedCheese && ingredients.cheese.find(c => c.id === selectedCheese) && (
                <div className="summary-item">
                  <span className="summary-label">Cheese:</span>
                  <span>{ingredients.cheese.find(c => c.id === selectedCheese).name}</span>
                </div>
              )}
              {selectedVegetables.length > 0 && (
                <div className="summary-item">
                  <span className="summary-label">Vegetables:</span>
                  <span>
                    {selectedVegetables
                      .map(id => ingredients.vegetable.find(v => v.id === id)?.name)
                      .filter(Boolean)
                      .join(', ') || 'None'}
                  </span>
                </div>
              )}
              {isNonVegetarian && selectedProteins.length > 0 && (
                <div className="summary-item">
                  <span className="summary-label">Proteins:</span>
                  <span>
                    {selectedProteins
                      .map(id => (ingredients.protein || []).find(p => p.id === id)?.name)
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
              )}
            </div>
            
            <div className="builder-quantity">
              <label htmlFor="pizza-quantity" className="builder-quantity__label">Quantity</label>
              <div className="quantity-control">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  id="pizza-quantity"
                  type="number"
                  className="quantity-value"
                  value={quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val <= 100) {
                      setQuantity(val);
                    }
                  }}
                  min="1"
                  max="100"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(100, quantity + 1))}
                  disabled={quantity >= 100}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
            
            <div className="builder-price">
              {loadingQuote ? (
                <span className="price-loading">Calculating...</span>
              ) : quoteError ? (
                <span className="price-error">{quoteError}</span>
              ) : quote && quote.lines && quote.lines[0] ? (
                <>
                  <span className="price-label">Unit Price</span>
                  <span className="price-value">{catalogueApi.formatPrice(quote.lines[0].unitPricePaise)}</span>
                  {quantity > 1 && (
                    <>
                      <span className="price-label" style={{ marginTop: '12px' }}>Total ({quantity} items)</span>
                      <span className="price-value">{catalogueApi.formatPrice(quote.lines[0].lineTotalPaise)}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="price-value">—</span>
              )}
            </div>
            
            <button
              type="button"
              className="button button--primary button--full builder-add-cart"
              onClick={handleAddToCart}
              disabled={
                !selectedBase ||
                !selectedSauce ||
                !selectedCheese ||
                (isNonVegetarian && selectedProteins.length === 0) ||
                loadingQuote ||
                !!quoteError
              }
            >
              Add to Cart
            </button>
          </div>
        </div>

        {/* Ingredient Selection */}
        <div className="builder-options">
          {/* Base Selection */}
          <section className="ingredient-section">
            <h3 className="ingredient-heading">
              <span className="ingredient-icon">🍞</span>
              Choose Your Base <span className="required-badge">Required</span>
            </h3>
            <div className="ingredient-grid">
              {ingredients.base.map(base => (
                <button
                  key={base.id}
                  type="button"
                  className={`ingredient-option ${selectedBase === base.id ? 'ingredient-option--selected' : ''} ${!base.inStock ? 'ingredient-option--unavailable' : ''}`}
                  onClick={() => base.inStock && setSelectedBase(base.id)}
                  disabled={!base.inStock}
                >
                  <span className="ingredient-name">{base.name}</span>
                  <span className="ingredient-price">{catalogueApi.formatPrice(base.pricePaise)}</span>
                  {!base.inStock && <span className="stock-badge">Out of stock</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Sauce Selection */}
          <section className="ingredient-section">
            <h3 className="ingredient-heading">
              <span className="ingredient-icon">🍅</span>
              Choose Your Sauce <span className="required-badge">Required</span>
            </h3>
            <div className="ingredient-grid">
              {ingredients.sauce.map(sauce => (
                <button
                  key={sauce.id}
                  type="button"
                  className={`ingredient-option ${selectedSauce === sauce.id ? 'ingredient-option--selected' : ''} ${!sauce.inStock ? 'ingredient-option--unavailable' : ''}`}
                  onClick={() => sauce.inStock && setSelectedSauce(sauce.id)}
                  disabled={!sauce.inStock}
                >
                  <span className="ingredient-name">{sauce.name}</span>
                  <span className="ingredient-price">{catalogueApi.formatPrice(sauce.pricePaise)}</span>
                  {!sauce.inStock && <span className="stock-badge">Out of stock</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Cheese Selection */}
          <section className="ingredient-section">
            <h3 className="ingredient-heading">
              <span className="ingredient-icon">🧀</span>
              Choose Your Cheese <span className="required-badge">Required</span>
            </h3>
            <div className="ingredient-grid">
              {ingredients.cheese.map(cheese => (
                <button
                  key={cheese.id}
                  type="button"
                  className={`ingredient-option ${selectedCheese === cheese.id ? 'ingredient-option--selected' : ''} ${!cheese.inStock ? 'ingredient-option--unavailable' : ''}`}
                  onClick={() => cheese.inStock && setSelectedCheese(cheese.id)}
                  disabled={!cheese.inStock}
                >
                  <span className="ingredient-name">{cheese.name}</span>
                  <span className="ingredient-price">{catalogueApi.formatPrice(cheese.pricePaise)}</span>
                  {!cheese.inStock && <span className="stock-badge">Out of stock</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Vegetable Selection */}
          <section className="ingredient-section">
            <h3 className="ingredient-heading">
              <span className="ingredient-icon">🥬</span>
              Add Vegetables <span className="optional-badge">Optional</span>
            </h3>
            <div className="ingredient-grid">
              {ingredients.vegetable.map(veg => (
                <button
                  key={veg.id}
                  type="button"
                  className={`ingredient-option ${selectedVegetables.includes(veg.id) ? 'ingredient-option--selected' : ''} ${!veg.inStock ? 'ingredient-option--unavailable' : ''}`}
                  onClick={() => veg.inStock && handleVegetableToggle(veg.id)}
                  disabled={!veg.inStock}
                >
                  <span className="ingredient-name">{veg.name}</span>
                  <span className="ingredient-price">{catalogueApi.formatPrice(veg.pricePaise)}</span>
                  {!veg.inStock && <span className="stock-badge">Out of stock</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Protein Selection - Only for Non-Vegetarian Pizzas */}
          {isNonVegetarian && (
            <section className="ingredient-section">
              <h3 className="ingredient-heading">
                <span className="ingredient-icon">🍗</span>
                Add Protein Toppings <span className="required-badge">Required</span>
              </h3>
              <div className="ingredient-grid">
                {ingredients.protein && ingredients.protein.length > 0 ? (
                  ingredients.protein.map(protein => (
                    <button
                      key={protein.id}
                      type="button"
                      className={`ingredient-option ${selectedProteins.includes(protein.id) ? 'ingredient-option--selected' : ''} ${!protein.inStock ? 'ingredient-option--unavailable' : ''}`}
                      onClick={() => protein.inStock && handleProteinToggle(protein.id)}
                      disabled={!protein.inStock}
                    >
                      <span className="ingredient-name">{protein.name}</span>
                      <span className="ingredient-price">{catalogueApi.formatPrice(protein.pricePaise)}</span>
                      {!protein.inStock && <span className="stock-badge">Out of stock</span>}
                    </button>
                  ))
                ) : (
                  <p className="ingredient-empty-state">
                    No protein toppings are currently available. Please check back later or contact support.
                  </p>
                )}
              </div>
            </section>
          )}

          <div className="builder-notice">
            <p>
              🛒 Pizza added to your cart! Review your selections, adjust quantities, and proceed to checkout from the cart page.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
