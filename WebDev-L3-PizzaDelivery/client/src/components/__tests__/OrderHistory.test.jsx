import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderHistory } from '../OrderHistory.jsx';
import * as ordersApi from '../../api/orders.js';

// Mock the orders API
vi.mock('../../api/orders.js', () => ({
  getOrders: vi.fn()
}));

describe('OrderHistory Component', () => {
  const mockOnViewDetails = vi.fn();
  const mockOnNotice = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    ordersApi.getOrders.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    expect(document.querySelectorAll('.order-card--skeleton').length).toBeGreaterThan(0);
  });

  it('displays empty state when no orders exist', async () => {
    ordersApi.getOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }
    });

    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no orders yet/i)).toBeInTheDocument();
    });
  });

  it('displays order list when orders exist', async () => {
    const mockOrders = [
      {
        orderId: '507f1f77bcf86cd799439011',
        items: [
          { name: 'Margherita', quantity: 2, lineTotalPaise: 40000 }
        ],
        totalPricePaise: 40000,
        orderState: 'received',
        paymentStatus: 'captured',
        createdAt: '2024-01-15T10:30:00Z'
      }
    ];

    ordersApi.getOrders.mockResolvedValue({
      orders: mockOrders,
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    });

    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: /#\s*439011/ })).toBeInTheDocument();
      expect(screen.getByText(/margherita/i)).toBeInTheDocument();
      expect(screen.getByText(/₹400/)).toBeInTheDocument();
    });
  });

  it('calls onViewDetails when view details button is clicked', async () => {
    const mockOrders = [
      {
        orderId: '507f1f77bcf86cd799439011',
        items: [{ name: 'Margherita', quantity: 1, lineTotalPaise: 20000 }],
        totalPricePaise: 20000,
        orderState: 'received',
        paymentStatus: 'captured',
        createdAt: '2024-01-15T10:30:00Z'
      }
    ];

    ordersApi.getOrders.mockResolvedValue({
      orders: mockOrders,
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    });

    const user = userEvent.setup();

    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/view details/i)).toBeInTheDocument();
    });

    const viewButton = screen.getByText(/view details/i);
    await user.click(viewButton);

    expect(mockOnViewDetails).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
  });

  it('displays error state on API failure', async () => {
    ordersApi.getOrders.mockRejectedValue(new Error('Network error'));

    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/unable to load orders/i)).toBeInTheDocument();
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('displays correct order status badges', async () => {
    const mockOrders = [
      {
        orderId: '507f1f77bcf86cd799439011',
        items: [{ name: 'Pizza 1', quantity: 1, lineTotalPaise: 20000 }],
        totalPricePaise: 20000,
        orderState: 'pending_payment',
        paymentStatus: 'pending_gateway',
        createdAt: '2024-01-15T10:30:00Z'
      },
      {
        orderId: '507f1f77bcf86cd799439012',
        items: [{ name: 'Pizza 2', quantity: 1, lineTotalPaise: 20000 }],
        totalPricePaise: 20000,
        orderState: 'in_kitchen',
        paymentStatus: 'captured',
        createdAt: '2024-01-15T11:00:00Z'
      }
    ];

    ordersApi.getOrders.mockResolvedValue({
      orders: mockOrders,
      pagination: { page: 1, limit: 10, total: 2, totalPages: 1 }
    });

    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/payment pending/i)).toBeInTheDocument();
      expect(screen.getByText(/in kitchen/i)).toBeInTheDocument();
    });
  });

  it('handles pagination correctly', async () => {
    const mockOrders = Array.from({ length: 10 }, (_, i) => ({
      orderId: `507f1f77bcf86cd79943901${i}`,
      items: [{ name: `Pizza ${i}`, quantity: 1, lineTotalPaise: 20000 }],
      totalPricePaise: 20000,
      orderState: 'received',
      paymentStatus: 'captured',
      createdAt: '2024-01-15T10:30:00Z'
    }));

    ordersApi.getOrders.mockResolvedValue({
      orders: mockOrders,
      pagination: { page: 1, limit: 10, total: 25, totalPages: 3 }
    });

    const user = userEvent.setup();

    render(
      <OrderHistory 
        onViewDetails={mockOnViewDetails}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/showing 10 of 25 orders/i)).toBeInTheDocument();
    });

    // Check that pagination controls are present
    const nextButton = screen.getByLabelText(/next page/i);
    expect(nextButton).toBeInTheDocument();
    expect(nextButton).not.toBeDisabled();

    // Click next page
    await user.click(nextButton);

    await waitFor(() => {
      expect(ordersApi.getOrders).toHaveBeenCalledWith(2, 10);
    });
  });
});
