import { useState, useEffect } from 'react';
import { updateProfile } from '../api/auth';

function ProfileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2L4 6v6c0 5 3 9 8 10 5-1 8-5 8-10V6l-8-4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function OrdersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M9 11l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function Profile({ user, onNavigate, onLogout, onUserUpdate, csrfToken }) {
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: '',
    phoneNumber: ''
  });
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Initialize form when user changes or editing starts
  useEffect(() => {
    if (user) {
      setEditForm({
        displayName: user.displayName || '',
        phoneNumber: user.phoneNumber || ''
      });
    }
  }, [user, isEditing]);

  // Format account creation date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  // Get user initials for avatar
  const getInitials = (email) => {
    if (!email) return '?';
    return email.charAt(0).toUpperCase();
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await onLogout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = () => {
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
    setSaveSuccess(false);
    // Reset form to current user values
    setEditForm({
      displayName: user.displayName || '',
      phoneNumber: user.phoneNumber || ''
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setEditForm(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear errors when user starts typing
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    
    if (!csrfToken) {
      setSaveError('Security token missing. Please refresh the page.');
      return;
    }

    setLoading(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await updateProfile(editForm, csrfToken);

if (typeof onUserUpdate !== 'function') {
  throw new Error('Profile refresh is unavailable.');
}

await onUserUpdate();

setSaveSuccess(true);
setIsEditing(false);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Profile update error:', err);
      setSaveError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  // Redirect if not authenticated
  if (!user) {
    return (
      <main className="profile-page">
        <section className="shell">
          <div className="empty-state">
            <ProfileIcon />
            <h3>Sign in required</h3>
            <p>Please sign in to view your profile</p>
            <button 
              type="button" 
              className="button button--primary"
              onClick={() => onNavigate('login')}
            >
              Sign in
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="profile-page">
      <section className="shell">
        <div className="profile-container">
          {/* Profile Header */}
          <div className="profile-header">
            <div className="profile-avatar">
              {getInitials(user.email)}
            </div>
            <div className="profile-header__text">
              <h1>My Profile</h1>
              <p>Manage your account information</p>
            </div>
          </div>

          {/* Profile Details Card */}
          <div className="profile-card">
            <div className="profile-card__header">
              <h2 className="profile-card__title">Account Details</h2>
              {!isEditing && (
                <button 
                  type="button"
                  className="button button--secondary button--small"
                  onClick={handleEditClick}
                >
                  Edit Profile
                </button>
              )}
            </div>

            {/* Success Message */}
            {saveSuccess && (
              <div className="alert alert--success">
                Profile updated successfully!
              </div>
            )}

            {/* Error Message */}
            {saveError && (
              <div className="alert alert--error">
                {saveError}
              </div>
            )}

            {isEditing ? (
              /* Edit Mode */
              <form onSubmit={handleSaveProfile} className="profile-edit-form">
                <div className="profile-info-grid">
                  <div className="form-group">
                    <label htmlFor="displayName">Display Name</label>
                    <input
                      type="text"
                      id="displayName"
                      name="displayName"
                      value={editForm.displayName}
                      onChange={handleInputChange}
                      placeholder="Your name (optional)"
                      maxLength={100}
                      className="input"
                    />
                    <small className="form-help">This will be shown on your profile</small>
                  </div>

                  <div className="form-group">
                    <label htmlFor="phoneNumber">Phone Number</label>
                    <input
                      type="tel"
                      id="phoneNumber"
                      name="phoneNumber"
                      value={editForm.phoneNumber}
                      onChange={handleInputChange}
                      placeholder="+91 XXX XXX XXXX (optional)"
                      maxLength={20}
                      className="input"
                    />
                    <small className="form-help">For future delivery notifications</small>
                  </div>

                  <div className="profile-info-item profile-info-item--readonly">
                    <div className="profile-info-item__icon">
                      <EmailIcon />
                    </div>
                    <div className="profile-info-item__content">
                      <label>Email Address</label>
                      <p>{user.email}</p>
                      <small className="form-help">Email cannot be changed</small>
                    </div>
                  </div>

                  <div className="profile-info-item profile-info-item--readonly">
                    <div className="profile-info-item__icon">
                      <ShieldIcon />
                    </div>
                    <div className="profile-info-item__content">
                      <label>Account Status</label>
                      <p>
                        <span className={`status-badge ${user.isVerified ? 'status-badge--verified' : 'status-badge--pending'}`}>
                          {user.isVerified ? '✓ Verified' : 'Pending Verification'}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="profile-edit-actions">
                  <button 
                    type="button"
                    className="button button--secondary"
                    onClick={handleCancelEdit}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="button button--primary"
                    disabled={loading}
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            ) : (
              /* View Mode */
              <div className="profile-info-grid">
                {user.displayName && (
                  <div className="profile-info-item">
                    <div className="profile-info-item__icon">
                      <ProfileIcon />
                    </div>
                    <div className="profile-info-item__content">
                      <label>Display Name</label>
                      <p>{user.displayName}</p>
                    </div>
                  </div>
                )}

                {user.phoneNumber && (
                  <div className="profile-info-item">
                    <div className="profile-info-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div className="profile-info-item__content">
                      <label>Phone Number</label>
                      <p>{user.phoneNumber}</p>
                    </div>
                  </div>
                )}

                <div className="profile-info-item">
                  <div className="profile-info-item__icon">
                    <EmailIcon />
                  </div>
                  <div className="profile-info-item__content">
                    <label>Email Address</label>
                    <p>{user.email}</p>
                  </div>
                </div>

                <div className="profile-info-item">
                  <div className="profile-info-item__icon">
                    <ShieldIcon />
                  </div>
                  <div className="profile-info-item__content">
                    <label>Account Status</label>
                    <p>
                      <span className={`status-badge ${user.isVerified ? 'status-badge--verified' : 'status-badge--pending'}`}>
                        {user.isVerified ? '✓ Verified' : 'Pending Verification'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="profile-info-item">
                  <div className="profile-info-item__icon">
                    <CalendarIcon />
                  </div>
                  <div className="profile-info-item__content">
                    <label>Member Since</label>
                    <p>{formatDate(user.createdAt)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions Card */}
          <div className="profile-actions-card">
            <h2 className="profile-card__title">Quick Actions</h2>
            
            <div className="profile-actions-grid">
              <button 
                type="button"
                className="profile-action-button"
                onClick={() => onNavigate('orders')}
              >
                <OrdersIcon />
                <div>
                  <strong>My Orders</strong>
                  <span>View order history and track deliveries</span>
                </div>
              </button>

              <button 
                type="button"
                className="profile-action-button profile-action-button--danger"
                onClick={handleLogout}
                disabled={loading}
              >
                <LogoutIcon />
                <div>
                  <strong>{loading ? 'Signing out...' : 'Sign Out'}</strong>
                  <span>Log out of your SUNNYS account</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
