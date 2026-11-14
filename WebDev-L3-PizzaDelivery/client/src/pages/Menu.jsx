import { useEffect, useState } from 'react';
import * as catalogueApi from '../api/catalogue.js';
import { useScrollAnimation } from '../hooks/useScrollAnimation.js';

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PizzaVisual({ kind = 'supreme', imageUrl, className = '' }) {
  // If there's a backend image, use it
  if (imageUrl) {
    return (
      <img 
        src={imageUrl} 
        alt={`${kind} pizza`}
        className={`pizza-card__image ${className}`}
        loading="lazy"
        onError={(e) => {
          // Fallback to illustration if image fails to load
          e.target.style.display = 'none';
          const sibling = e.target.nextElementSibling;
          if (sibling) sibling.classList.remove('hidden');
        }}
      />
    );
  }
  
  // Otherwise use the existing SVG illustration
  return <PizzaArt kind={kind} className={className} />;
}

// Original vector pizza illustration fallback
function PizzaArt({ kind = 'supreme', className = '' }) {
  const uid = `pizza-${kind}-${Math.random().toString(36).substr(2, 9)}`;
  const pepperoni = kind === 'pepperoni' || kind === 'non-vegetarian';
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

export function Menu({ onNavigate, onNotice, user, onViewPizza, onPizzasLoaded }) {
  const [category, setCategory] = useState('All pizzas');
  const [searchQuery, setSearchQuery] = useState('');
  const [pizzas, setPizzas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const setCardRef = useScrollAnimation(true);
  
  useEffect(() => {
    async function fetchPizzas() {
      // Only fetch pizzas if authenticated
      if (!user) {
        setPizzas([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');
        const cataloguePizzas = await catalogueApi.getPizzas();
        
        // Transform backend pizza format to display format
        const displayPizzas = cataloguePizzas.map(pizza => ({
          id: pizza.id,
          name: pizza.name,
          description: pizza.description || 'Delicious pizza with fresh ingredients',
          price: catalogueApi.formatPrice(pizza.pricePaise),
          kind: pizza.category, // Use actual backend category
          category: pizza.category, // PizzaBuilder requires category for protein toppings
          label: pizza.available ? 'Available' : 'Out of stock',
          available: pizza.available,
          ingredients: pizza.ingredients,
          imageUrl: pizza.imageUrl, // Backend-managed image
        }));
        
        setPizzas(displayPizzas);
        // Pass pizzas to parent for builder navigation
        if (onPizzasLoaded) {
          onPizzasLoaded(displayPizzas);
        }
      } catch (err) {
        console.error('Failed to fetch pizzas:', err);
        setError(err.message);
        // Show error state, don't use placeholder pizzas
        setPizzas([]);
      } finally {
        setLoading(false);
      }
    }

    fetchPizzas();
  }, [user, onPizzasLoaded]);
  
  const categories = ['All pizzas', 'Vegetarian', 'Non-Vegetarian', 'Vegan'];
  
  // Filter by category and search query
  const visiblePizzas = pizzas.filter(p => {
    // Category filter
    const categoryMatch = category === 'All pizzas' || 
      (category === 'Vegetarian' && p.kind === 'vegetarian') ||
      (category === 'Non-Vegetarian' && p.kind === 'non-vegetarian') ||
      (category === 'Vegan' && p.kind === 'vegan');
    
    // Search filter
    const searchMatch = !searchQuery || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    return categoryMatch && searchMatch;
  });
  
  return (
    <main className="menu-page">
      <section className="menu-section shell">
        <div className="section-heading">
          <div>
            <p className="section-kicker">THE GOOD STUFF</p>
            <h2>Meet your new <span>favourites.</span></h2>
            <p>Something delicious for every kind of craving.</p>
          </div>
        </div>

        {/* Search and Filters */}
        {user && (
          <div className="menu-controls">
            <div className="search-bar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input
                type="search"
                placeholder="Search pizzas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search pizzas"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="search-clear"
                >
                  ×
                </button>
              )}
            </div>
            <div className="categories" role="group" aria-label="Pizza categories">
              {categories.map(item => (
                <button
                  key={item}
                  className={`category-chip ${category === item ? 'category-chip--active' : ''}`}
                  onClick={() => setCategory(item)}
                  type="button"
                >
                  {item === 'All pizzas' ? '🍕' : item === 'Vegetarian' ? '🥬' : item === 'Vegan' ? '🌱' : '🍖'} {item}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {/* Not Authenticated State */}
        {!loading && !user && (
          <div className="empty-state">
            <svg width="60" height="60" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <path d="M8 10C20 4 34 9 43 19L20 43Z" fill="#F8A72C" stroke="#6F3415" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M8 10C20 4 34 9 43 19" fill="none" stroke="#FFE09C" strokeWidth="6" strokeLinecap="round" />
              <circle cx="23" cy="19" r="4.3" fill="#DD4B36" /><circle cx="31" cy="26" r="4" fill="#DD4B36" />
              <circle cx="17" cy="28" r="3.5" fill="#205735" /><path d="M29 11l3-7M39 12l5-4" stroke="#00D276" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <h3>Sign in to see our menu</h3>
            <p>Join SUNNYS to explore our delicious pizzas and start ordering</p>
            <div className="empty-state__actions">
              <button 
                type="button" 
                className="button button--primary"
                onClick={() => onNavigate('login')}
              >
                Sign in
              </button>
              <button 
                type="button" 
                className="button button--outline"
                onClick={() => onNavigate('register')}
              >
                Create account
              </button>
            </div>
          </div>
        )}
        
        {/* Loading State */}
        {loading && user && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading delicious pizzas...</p>
          </div>
        )}
        
        {/* Error State */}
        {!loading && error && user && (
          <div className="error-state">
            <p className="error-state__title">⚠ Failed to load menu</p>
            <p className="error-state__message">{error}</p>
            <button 
              type="button" 
              className="button button--primary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        )}
        
        {/* Empty Search Results */}
        {!loading && visiblePizzas.length === 0 && !error && user && (
          <div className="empty-state">
            <div className="empty-state__icon">🔍</div>
            <h3>No pizzas found</h3>
            <p>
              {searchQuery 
                ? `No results for "${searchQuery}". Try a different search term.`
                : `No pizzas available in the ${category} category.`}
            </p>
            {searchQuery && (
              <button 
                type="button" 
                className="button button--outline"
                onClick={() => setSearchQuery('')}
              >
                Clear search
              </button>
            )}
          </div>
        )}
        
        {/* Pizza Grid */}
        {!loading && visiblePizzas.length > 0 && (
          <>
            <div className="results-count">
              {visiblePizzas.length} {visiblePizzas.length === 1 ? 'pizza' : 'pizzas'} available
            </div>
            <div className="pizza-grid">
              {visiblePizzas.map((pizza, index) => (
                <article 
                  ref={setCardRef(index)}
                  className="pizza-card" 
                  key={pizza.id || pizza.name}
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className={`pizza-card__art pizza-card__art--${pizza.kind}`}>
                    {!pizza.available && (
                      <div className="pizza-card__unavailable">Out of stock</div>
                    )}
                    {pizza.available && pizza.label && (
                      <span className="pizza-card__badge">{pizza.label}</span>
                    )}
                    <PizzaVisual kind={pizza.kind} imageUrl={pizza.imageUrl} />
                  </div>
                  <div className="pizza-card__body">
                    <h3>{pizza.name}</h3>
                    <p>{pizza.description}</p>
                    <div className="pizza-card__footer">
                      <div className="pizza-card__price">
                        <small>Price</small>
                        <strong>{pizza.price}</strong>
                      </div>
                      <button 
                        type="button" 
                        className="pizza-card__button"
                        aria-label={`Customize ${pizza.name}`} 
                        onClick={() => {
                          if (!user) {
                            onNotice('Please sign in to order pizzas.');
                            onNavigate('login');
                          } else {
                            onViewPizza(pizza);
                          }
                        }}
                        disabled={!pizza.available}
                      >
                        {pizza.available ? (
                          <>
                            Customize <ArrowIcon />
                          </>
                        ) : (
                          'Unavailable'
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
