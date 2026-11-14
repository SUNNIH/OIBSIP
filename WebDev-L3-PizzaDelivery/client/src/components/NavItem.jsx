// Reusable navigation item for sidebar
export function NavItem({ 
  icon, 
  label, 
  onClick, 
  isActive = false, 
  isCollapsed = false,
  badge = null,
  isPrimary = false,
  ariaLabel
}) {
  return (
    <button
      type="button"
      className={`nav-item ${isActive ? 'nav-item--active' : ''} ${isPrimary ? 'nav-item--primary' : ''} ${isCollapsed ? 'nav-item--collapsed' : ''}`}
      onClick={onClick}
      aria-label={ariaLabel || label}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="nav-item__icon">{icon}</span>
      {!isCollapsed && (
        <>
          <span className="nav-item__label">{label}</span>
          {badge !== null && badge > 0 && (
            <span className="nav-item__badge" aria-label={`${badge} items`}>
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
      {isCollapsed && badge !== null && badge > 0 && (
        <span className="nav-item__badge nav-item__badge--dot" aria-label={`${badge} items`} />
      )}
    </button>
  );
}
