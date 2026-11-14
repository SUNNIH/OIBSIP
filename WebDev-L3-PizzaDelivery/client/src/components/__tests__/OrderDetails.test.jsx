import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderDetails } from '../OrderDetails.jsx';
import * as ordersApi from '../../api/orders.js';

// Mock the orders API
vi.mock('../../api/orders.js', () => ({
  getOrder: vi.fn()
}));

describe('OrderDetails Component', () => {
  const mockOnBack = vi.fn();
  const mockOnNotice = vi.fn();
  const mockOrderId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    ordersApi.getOrder.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    expect(screen.getByText(/loading order details/i)).toBeInTheDocument();
  });

  it('displays order details when loaded', async () => {
    const mockOrder = {
      orderId: mockOrderId,
      items: [
        {
          name: 'Margherita',
          quantity: 2,
          base: { name: 'Thin Crust', pricePaise: 10000 },
          sauce: { name: 'Tomato', pricePaise: 3000 },
          cheese: { name: 'Mozzarella', pricePaise: 5000 },
          vegetables: [{ name: 'Basil', pricePaise: 2000 }],
          unitPricePaise: 20000,
          lineTotalPaise: 40000
        }
      ],
      totalPricePaise: 40000,
      orderState: 'received',
      paymentStatus: 'captured',
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T10:30:00Z'
    };

    ordersApi.getOrder.mockResolvedValue(mockOrder);

    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/order received/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/margherita/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/thin crust/i)).toBeInTheDocument();
      expect(screen.getAllByText(/₹400/).length).toBeGreaterThan(0);
    });
  });

  it('displays order progress for active orders', async () => {
    const mockOrder = {
      orderId: mockOrderId,
      items: [
        {
          name: 'Pizza',
          quantity: 1,
          base: { name: 'Thin Crust', pricePaise: 10000 },
          sauce: { name: 'Tomato', pricePaise: 3000 },
          cheese: { name: 'Mozzarella', pricePaise: 5000 },
          vegetables: [],
          unitPricePaise: 18000,
          lineTotalPaise: 18000
        }
      ],
      totalPricePaise: 18000,
      orderState: 'in_kitchen',
      paymentStatus: 'captured',
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T10:30:00Z'
    };

    ordersApi.getOrder.mockResolvedValue(mockOrder);

    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/order progress/i)).toBeInTheDocument();
      // Progress tracker shows all stages
      expect(screen.getAllByText(/in kitchen/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/sent to delivery/i)).toBeInTheDocument();
    });
  });

  it('does not display progress for pending payment orders', async () => {
    const mockOrder = {
      orderId: mockOrderId,
      items: [
        {
          name: 'Pizza',
          quantity: 1,
          base: { name: 'Thin Crust', pricePaise: 10000 },
          sauce: { name: 'Tomato', pricePaise: 3000 },
          cheese: { name: 'Mozzarella', pricePaise: 5000 },
          vegetables: [],
          unitPricePaise: 18000,
          lineTotalPaise: 18000
        }
      ],
      totalPricePaise: 18000,
      orderState: 'pending_payment',
      paymentStatus: 'pending_gateway',
      reservationExpiresAt: '2024-01-15T11:00:00Z',
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T10:30:00Z'
    };

    ordersApi.getOrder.mockResolvedValue(mockOrder);

    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/payment pending/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/order progress/i)).not.toBeInTheDocument();
      expect(screen.getByText(/payment required/i)).toBeInTheDocument();
    });
  });

  it('calls onBack when back button is clicked', async () => {
    const mockOrder = {
      orderId: mockOrderId,
      items: [
        {
          name: 'Pizza',
          quantity: 1,
          base: { name: 'Thin Crust', pricePaise: 10000 },
          sauce: { name: 'Tomato', pricePaise: 3000 },
          cheese: { name: 'Mozzarella', pricePaise: 5000 },
          vegetables: [],
          unitPricePaise: 18000,
          lineTotalPaise: 18000
        }
      ],
      totalPricePaise: 18000,
      orderState: 'received',
      paymentStatus: 'captured',
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T10:30:00Z'
    };

    ordersApi.getOrder.mockResolvedValue(mockOrder);

    const user = userEvent.setup();

    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/back to orders/i)).toBeInTheDocument();
    });

    const backButton = screen.getByText(/back to orders/i);
    await user.click(backButton);

    expect(mockOnBack).toHaveBeenCalled();
  });

  it('displays error state on API failure', async () => {
    ordersApi.getOrder.mockRejectedValue(new Error('Order not found'));

    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/unable to load order/i)).toBeInTheDocument();
      expect(screen.getByText(/order not found/i)).toBeInTheDocument();
    });
  });

  it('displays all order item details correctly', async () => {
    const mockOrder = {
      orderId: mockOrderId,
      items: [
        {
          name: 'Custom Pizza',
          quantity: 2,
          base: { name: 'Thick Crust', pricePaise: 12000 },
          sauce: { name: 'Pesto', pricePaise: 4000 },
          cheese: { name: 'Parmesan', pricePaise: 6000 },
          vegetables: [
            { name: 'Mushrooms', pricePaise: 3000 },
            { name: 'Bell Peppers', pricePaise: 2000 }
          ],
          unitPricePaise: 27000,
          lineTotalPaise: 54000
        }
      ],
      totalPricePaise: 54000,
      orderState: 'sent_to_delivery',
      paymentStatus: 'captured',
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T11:00:00Z'
    };

    ordersApi.getOrder.mockResolvedValue(mockOrder);

    render(
      <OrderDetails 
        orderId={mockOrderId}
        onBack={mockOnBack}
        onNotice={mockOnNotice}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/custom pizza/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/thick crust/i)).toBeInTheDocument();
      expect(screen.getByText(/pesto/i)).toBeInTheDocument();
      expect(screen.getByText(/parmesan/i)).toBeInTheDocument();
      expect(screen.getByText(/mushrooms/i)).toBeInTheDocument();
      expect(screen.getByText(/bell peppers/i)).toBeInTheDocument();
      expect(screen.getByText(/qty: 2/i)).toBeInTheDocument();
      expect(screen.getAllByText(/₹540/).length).toBeGreaterThan(0);
    });
  });
});
