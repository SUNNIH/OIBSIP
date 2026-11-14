// SUNNYS Pizza — Order Status Polling Hook
// Implements lightweight polling for live order status updates

import { useEffect, useRef, useState } from 'react';

/**
 * Custom hook for polling order status updates
 * @param {Function} fetchFunction - Async function that fetches fresh data
 * @param {number} interval - Polling interval in milliseconds (default: 15000)
 * @param {Object} options - Additional options
 * @param {boolean} options.enabled - Whether polling is enabled
 * @param {Function} options.onUpdate - Callback when data changes
 * @returns {Object} - { data, error, isPolling }
 */
export function useOrderPolling(fetchFunction, interval = 15000, options = {}) {
  const { enabled = true, onUpdate } = options;
  
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  
  const intervalRef = useRef(null);
  const previousDataRef = useRef(null);
  const isInitialLoadRef = useRef(true);
  const requestVersionRef = useRef(0);
  
  // Detect if tab is hidden/visible
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden);
  
  useEffect(() => {
    function handleVisibilityChange() {
      setIsTabVisible(!document.hidden);
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  
  // Poll function that fetches and compares data
  const poll = async () => {
    if (!enabled || !isTabVisible) return;
    
    const currentVersion = ++requestVersionRef.current;
    
    try {
      setIsPolling(true);
      setError(null);
      
      const freshData = await fetchFunction();
      
      // Ignore stale responses
      if (currentVersion !== requestVersionRef.current) {
        return;
      }
      
      // Check if data actually changed
      const previousData = previousDataRef.current;
      const hasChanged = !previousData || JSON.stringify(freshData) !== JSON.stringify(previousData);
      
      setData(freshData);
      previousDataRef.current = freshData;
      
      // Only notify on actual changes, not initial load
      if (hasChanged && !isInitialLoadRef.current && onUpdate) {
        onUpdate(freshData, previousData);
      }
      
      isInitialLoadRef.current = false;
      
    } catch (err) {
      // Ignore version mismatch
      if (currentVersion !== requestVersionRef.current) {
        return;
      }
      
      console.error('Polling error:', err);
      setError(err);
      
      // Don't clear data on error - keep showing last valid data
    } finally {
      if (currentVersion === requestVersionRef.current) {
        setIsPolling(false);
      }
    }
  };
  
  useEffect(() => {
    if (!enabled) {
      // Clear interval when disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    
    // Initial fetch
    poll();
    
    // Set up interval
    intervalRef.current = setInterval(poll, interval);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, isTabVisible]);
  
  // Refresh immediately when tab becomes visible after being hidden
  useEffect(() => {
    if (isTabVisible && enabled && !isInitialLoadRef.current) {
      poll();
    }
  }, [isTabVisible, enabled]);
  
  return { data, error, isPolling };
}

/**
 * Detect order status transitions
 * @param {Object} newOrder - New order data
 * @param {Object} oldOrder - Previous order data
 * @returns {Object|null} - Transition info or null if no transition
 */
export function detectOrderTransition(newOrder, oldOrder) {
  if (!oldOrder || !newOrder) return null;
  
  const oldState = oldOrder.orderState;
  const newState = newOrder.orderState;
  
  if (oldState === newState) return null;
  
  return {
    from: oldState,
    to: newState,
    orderId: newOrder.orderId
  };
}
