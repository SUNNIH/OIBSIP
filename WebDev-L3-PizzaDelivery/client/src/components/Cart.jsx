import { useState, useEffect, useRef } from 'react';
import * as catalogueApi from '../api/catalogue.js';
import * as cartUtils from '../utils/cart.js';

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Cart({
  onNavigate,
  csrfToken,
  onNotice,
  user,
  onCartUpdate
}) {
  const userId = cartUtils.getCartOwnerId(user);

const [cart, setCart] = useState(() => cartUtils.loadCart(user));
  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const quoteRequestRef = useRef(0);
  const quoteTimerRef = useRef(null);

useEffect(() => {
  // Invalidate pending quotes from the previous account.
  quoteRequestRef.current += 1;

  if (quoteTimerRef.current) {
    clearTimeout(quoteTimerRef.current);
  }

  setCart(cartUtils.loadCart(user));
  setQuote(null);
  setQuoteError('');
  setLoadingQuote(false);
}, [userId]);


  function persistCart(updatedCart) {
  if (!cartUtils.saveCart(updatedCart, user)) {
    onNotice('Unable to save cart.');
    return false;
  }

  setCart(updatedCart);
  onCartUpdate?.();
  return true;
}

  
  // Get quote when cart changes (debounced)
  useEffect(() => {
    if (cart.length === 0) {
      setQuote(null);
      setQuoteError('');
      return;
    }

    if (!csrfToken || !user) {
      setQuoteError('Please sign in to get price quotes.');
      return;
    }

    // Clear existing timer
    if (quoteTimerRef.current) {
      clearTimeout(quoteTimerRef.current);
    }

    // Debounce quote requests by 500ms
    quoteTimerRef.current = setTimeout(() => {
      fetchQuote();
    }, 500);

    return () => {
      if (quoteTimerRef.current) {
        clearTimeout(quoteTimerRef.current);
      }
    };
  }, [cart, csrfToken, user]);

  async function fetchQuote() {
    const currentRequestId = quoteRequestRef.current + 1;
    quoteRequestRef.current = currentRequestId;

    try {
      setLoadingQuote(true);
      setQuoteError('');

      const lines = cartUtils.cartToQuoteLines(cart);
      const quoteData = await catalogueApi.getQuote(lines, csrfToken);

      // Only update if this is still the latest request
      if (currentRequestId === quoteRequestRef.current) {
        setQuote(quoteData);
      }
    } catch (err) {
      console.error('Failed to get cart quote:', err);
      // Only update error if this is the latest request
      if (currentRequestId === quoteRequestRef.current) {
        setQuoteError(err.message);
      }
    } finally {
      if (currentRequestId === quoteRequestRef.current) {
        setLoadingQuote(false);
      }
    }
  }

  function handleUpdateQuantity(itemId, newQuantity) {
  try {
    const updatedCart = cartUtils.updateQuantity(cart, itemId, newQuantity);
    persistCart(updatedCart);
  } catch (err) {
    onNotice(err.message);
  }
}

function handleRemoveItem(itemId) {
  const updatedCart = cartUtils.removeFromCart(cart, itemId);

  if (persistCart(updatedCart)) {
    onNotice('Item removed from cart');
  }
}

function handleClearCart() {
  if (window.confirm('Are you sure you want to clear your cart?')) {
    if (persistCart(cartUtils.clearCart())) {
      onNotice('Cart cleared');
    }
  }
}

  function getIngredientSummary(recipe) {
  const parts = [];

  // Required ingredients
  if (recipe.base) parts.push('Base');
  if (recipe.sauce) parts.push('Sauce');
  if (recipe.cheese) parts.push('Cheese');

  // Vegetable toppings
  const vegetableCount = Array.isArray(recipe.vegetables)
    ? recipe.vegetables.length
    : 0;

  if (vegetableCount > 0) {
    parts.push(
      `${vegetableCount} vegetable${vegetableCount !== 1 ? 's' : ''}`
    );
  }

  // Protein toppings
  const proteinCount = Array.isArray(recipe.proteins)
    ? recipe.proteins.length
    : 0;

  if (proteinCount > 0) {
    parts.push(
      `${proteinCount} protein${proteinCount !== 1 ? 's' : ''}`
    );
  }

  return parts.join(', ');
}

  if (!user) {
    return (
      <main className="cart-page shell">
        <div className="cart-header">
          <h1 className="cart-title">Shopping Cart</h1>
        </div>
        <div className="cart-empty">
          <div className="cart-empty__icon">🛒</div>
          <h2>Sign in required</h2>
          <p>Please sign in to view your shopping cart.</p>
          <button 
            type="button" 
            className="button button--primary"
            onClick={() => onNavigate('login')}
          >
            Sign in <ArrowIcon />
          </button>
        </div>
      </main>
    );
  }

  if (cart.length === 0) {
    return (
      <main className="cart-page shell">
        <div className="cart-header">
          <h1 className="cart-title">Shopping Cart</h1>
        </div>
        <div className="cart-empty">
          <div className="cart-empty__icon">🛒</div>
          <h2>Your cart is empty</h2>
          <p>Start building your perfect pizza and add it to your cart.</p>
          <button 
            type="button" 
            className="button button--primary"
            onClick={() => onNavigate('menu')}
          >
            Browse menu <ArrowIcon />
          </button>
        </div>
      </main>
    );
  }

  const totalItems = cartUtils.getCartItemCount(cart);

  return (
    <main className="cart-page shell">
      <div className="cart-header">
        <h1 className="cart-title">Shopping Cart</h1>
        <p className="cart-subtitle">
          {totalItems} item{totalItems !== 1 ? 's' : ''} in your cart
        </p>
      </div>

      <div className="cart-layout">
        <div className="cart-items">
          {cart.map((item, index) => {
            const quoteLine = quote?.lines?.[index];
            
            return (
              <div key={item.id} className="cart-item">
                <div className="cart-item__info">
                  <h3 className="cart-item__name">{item.name}</h3>
                  <p className="cart-item__ingredients">
  {getIngredientSummary(item.recipe)}
</p>
                </div>
                
                <div className="cart-item__controls">
                  <div className="quantity-control">
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                      disabled={item.quantity <= cartUtils.CART_LIMITS.MIN_QUANTITY}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="quantity-value">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                      disabled={item.quantity >= cartUtils.CART_LIMITS.MAX_QUANTITY}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  
                  <div className="cart-item__price">
                    {loadingQuote ? (
                      <span className="price-loading">...</span>
                    ) : quoteError ? (
                      <span className="price-error">—</span>
                    ) : quoteLine ? (
                      <>
                        <span className="price-unit">
                          {catalogueApi.formatPrice(quoteLine.unitPricePaise)} each
                        </span>
                        <span className="price-line">
                          {catalogueApi.formatPrice(quoteLine.lineTotalPaise)}
                        </span>
                      </>
                    ) : (
                      <span className="price-loading">—</span>
                    )}
                  </div>
                  
                  <button
                    type="button"
                    className="cart-item__remove"
                    onClick={() => handleRemoveItem(item.id)}
                    aria-label="Remove item"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cart-summary">
          <h2 className="cart-summary__title">Order Summary</h2>
          
          {quoteError && (
            <div className="cart-error">
              <p>{quoteError}</p>
            </div>
          )}
          
          <div className="cart-summary__totals">
            <div className="cart-summary__row">
              <span>Subtotal ({totalItems} item{totalItems !== 1 ? 's' : ''})</span>
              <span>
                {loadingQuote ? (
                  'Calculating...'
                ) : quoteError ? (
                  '—'
                ) : quote ? (
                  catalogueApi.formatPrice(quote.totalPaise)
                ) : (
                  '—'
                )}
              </span>
            </div>
          </div>
          
          <button
            type="button"
            className="button button--primary button--full cart-checkout"
            disabled={loadingQuote || !!quoteError}
            onClick={() => onNavigate('checkout')}
          >
            Proceed to Checkout <ArrowIcon />
          </button>
          
          <button
            type="button"
            className="button button--outline button--full"
            onClick={() => onNavigate('menu')}
          >
            Continue Shopping
          </button>
          
          <button
            type="button"
            className="cart-clear-link"
            onClick={handleClearCart}
          >
            Clear cart
          </button>
        </div>
      </div>
    </main>
  );
}
