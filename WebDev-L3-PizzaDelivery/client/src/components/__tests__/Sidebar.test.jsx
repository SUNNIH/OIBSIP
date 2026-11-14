import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../Sidebar.jsx';

describe('Sidebar Component', () => {
  const mockOnNavigate = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnToggleCollapse = vi.fn();
  const mockOnLogout = vi.fn();
  const mockOnToggleTheme = vi.fn();

  const defaultProps = {
    isOpen: true,
    isCollapsed: false,
    onClose: mockOnClose,
    onToggleCollapse: mockOnToggleCollapse,
    view: 'home',
    user: null,
    cartCount: 0,
    onNavigate: mockOnNavigate,
    onLogout: mockOnLogout,
    theme: 'dark',
    onToggleTheme: mockOnToggleTheme
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sidebar with navigation items', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Our Pizzas')).toBeInTheDocument();
  });

  it('shows authenticated navigation when user is logged in', () => {
    const user = { email: 'test@example.com' };
    
    render(<Sidebar {...defaultProps} user={user} />);

    expect(screen.getByText('My Orders')).toBeInTheDocument();
    expect(screen.getByText('Cart')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument(); // Username from email
  });

  it('shows sign in/register when user is not logged in', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText('Sign In')).toBeInTheDocument();
    expect(screen.getByText('Join SUNNYS')).toBeInTheDocument();
    expect(screen.queryByText('My Orders')).not.toBeInTheDocument();
  });

  it('calls onNavigate when home is clicked', async () => {
    const user = userEvent.setup();
    
    render(<Sidebar {...defaultProps} />);

    const homeButton = screen.getByText('Home');
    await user.click(homeButton);

    expect(mockOnNavigate).toHaveBeenCalledWith('home');
  });

  it('displays cart badge when items exist', () => {
    const user = { email: 'test@example.com' };
    
    render(<Sidebar {...defaultProps} user={user} cartCount={5} />);

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('highlights active navigation item', () => {
    render(<Sidebar {...defaultProps} view="home" />);

    const homeButton = screen.getByText('Home').closest('button');
    expect(homeButton).toHaveClass('nav-item--active');
  });

  it('calls onToggleTheme when theme button is clicked', async () => {
    const user = userEvent.setup();
    
    render(<Sidebar {...defaultProps} />);

    const themeButton = screen.getByLabelText(/switch to light mode/i);
    await user.click(themeButton);

    expect(mockOnToggleTheme).toHaveBeenCalled();
  });

  it('calls onLogout when sign out is clicked', async () => {
    const user = userEvent.setup();
    const authenticatedUser = { email: 'test@example.com' };
    
    render(<Sidebar {...defaultProps} user={authenticatedUser} />);

    const logoutButton = screen.getByText('Sign Out');
    await user.click(logoutButton);

    expect(mockOnLogout).toHaveBeenCalled();
  });

  it('shows collapsed state correctly', () => {
    render(<Sidebar {...defaultProps} isCollapsed={true} />);

    // Labels should be hidden in collapsed state
    const sidebar = document.querySelector('.sidebar');
    expect(sidebar).toHaveClass('sidebar--collapsed');
  });
});
