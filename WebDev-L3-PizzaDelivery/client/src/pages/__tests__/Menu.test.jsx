import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Menu } from '../Menu.jsx';
import * as catalogueApi from '../../api/catalogue.js';

// Mock the catalogue API
vi.mock('../../api/catalogue.js', () => ({
  getPizzas: vi.fn(),
  formatPrice: vi.fn((paise) => `₹${(paise / 100).toFixed(2)}`),
}));

describe('Menu Component', () => {
  const mockNavigate = vi.fn();
  const mockNotice = vi.fn();
  const mockViewPizza = vi.fn();
  const mockPizzasLoaded = vi.fn();

  const mockPizzas = [
    {
      id: 'pizza-1',
      name: 'Margherita',
      description: 'Classic cheese and tomato',
      pricePaise: 29900,
      category: 'vegetarian',
      available: true,
      imageUrl: '/api/images/pizzas/margherita.jpg',
      ingredients: [],
    },
    {
      id: 'pizza-2',
      name: 'Pepperoni',
      description: 'Spicy pepperoni slices',
      pricePaise: 34900,
      category: 'non-vegetarian',
      available: true,
      imageUrl: null,
      ingredients: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows sign-in prompt when user is not authenticated', async () => {
    render(
      <Menu
        onNavigate={mockNavigate}
        onNotice={mockNotice}
        user={null}
        onViewPizza={mockViewPizza}
        onPizzasLoaded={mockPizzasLoaded}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Sign in to see our menu')).toBeInTheDocument();
    });

    expect(catalogueApi.getPizzas).not.toHaveBeenCalled();
  });

  it('fetches and displays pizzas when user is authenticated', async () => {
    catalogueApi.getPizzas.mockResolvedValue(mockPizzas);

    render(
      <Menu
        onNavigate={mockNavigate}
        onNotice={mockNotice}
        user={{ email: 'test@example.com' }}
        onViewPizza={mockViewPizza}
        onPizzasLoaded={mockPizzasLoaded}
      />
    );

    // Should show loading initially
    expect(screen.getByText('Loading delicious pizzas...')).toBeInTheDocument();

    // Wait for pizzas to load
    await waitFor(() => {
      expect(screen.getByText('Margherita')).toBeInTheDocument();
      expect(screen.getByText('Pepperoni')).toBeInTheDocument();
    });

    expect(catalogueApi.getPizzas).toHaveBeenCalledOnce();
    expect(mockPizzasLoaded).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'pizza-1',
          name: 'Margherita',
          price: '₹299.00',
        }),
      ])
    );
  });

  it('shows error state when catalogue fetch fails', async () => {
    catalogueApi.getPizzas.mockRejectedValue(new Error('Network error'));

    render(
      <Menu
        onNavigate={mockNavigate}
        onNotice={mockNotice}
        user={{ email: 'test@example.com' }}
        onViewPizza={mockViewPizza}
        onPizzasLoaded={mockPizzasLoaded}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('⚠ Failed to load menu')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('filters pizzas by category', async () => {
    catalogueApi.getPizzas.mockResolvedValue(mockPizzas);

    const { getByRole } = render(
      <Menu
        onNavigate={mockNavigate}
        onNotice={mockNotice}
        user={{ email: 'test@example.com' }}
        onViewPizza={mockViewPizza}
        onPizzasLoaded={mockPizzasLoaded}
      />
    );

    // Wait for pizzas to load
    await waitFor(() => {
      expect(screen.getByText('Margherita')).toBeInTheDocument();
    });

    // Both pizzas should be visible initially
    expect(screen.getByText('Margherita')).toBeInTheDocument();
    expect(screen.getByText('Pepperoni')).toBeInTheDocument();

    // Click Vegetarian filter
    const vegButton = getByRole('button', { name: /🥬 Vegetarian/i });
    vegButton.click();

    // Only vegetarian pizza should be visible
    await waitFor(() => {
      expect(screen.getByText('Margherita')).toBeInTheDocument();
      expect(screen.queryByText('Pepperoni')).not.toBeInTheDocument();
    });
  });

  it('displays results count when pizzas loaded successfully', async () => {
    catalogueApi.getPizzas.mockResolvedValue(mockPizzas);

    render(
      <Menu
        onNavigate={mockNavigate}
        onNotice={mockNotice}
        user={{ email: 'test@example.com' }}
        onViewPizza={mockViewPizza}
        onPizzasLoaded={mockPizzasLoaded}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('2 pizzas available')).toBeInTheDocument();
    });
  });
});
