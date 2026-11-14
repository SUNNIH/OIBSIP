import { useEffect, useRef, useState } from 'react';
import * as catalogueApi from '../api/catalogue.js';
import * as ordersApi from '../api/orders.js';
import * as paymentsApi from '../api/payments.js';
import * as cartUtils from '../utils/cart.js';
const CHECKOUT_KEY = 'sunnys-checkout-state';
const VERIFICATION_KEY = 'sunnys-pending-payment-verification';
const UNRESOLVED_KEY = 'sunnys-unresolved-payment-order-id';
function getAccountStorageKey(baseKey, user) {
  const userId = cartUtils.getCartOwnerId(user);
  if (!userId) return null;
  return `${baseKey}:${userId}`;
}
const DEFINITIVE_ORDER_ERRORS = new Set([
  'VALIDATION_ERROR',
  'INVALID_ITEMS',
  'INSUFFICIENT_STOCK',
  'INVALID_IDEMPOTENCY_KEY',
  'MISSING_IDEMPOTENCY_KEY'
]);
const UNCERTAIN_GATEWAY_ERRORS = new Set([
  'GATEWAY_OUTCOME_UNKNOWN',
  'GATEWAY_RECONCILIATION_REQUIRED',
  'GATEWAY_LOCK_HELD',
  'FENCING_VIOLATION',
  'INVALID_RESPONSE'
]);
function loadCheckoutState(user) {
  try {
    const key = getAccountStorageKey(CHECKOUT_KEY, user);
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const state = JSON.parse(raw);
    const hasAttempt =
      Array.isArray(state?.lines) && state.lines.length > 0;
    return typeof state?.idempotencyKey === 'string' &&
      (typeof state.orderId === 'string' || hasAttempt)
      ? state
      : null;
  } catch (error) {
    console.error('Unable to read checkout state:', error);
    return null;
  }
}
function saveCheckoutState(state, user) {
  try {
    const key = getAccountStorageKey(CHECKOUT_KEY, user);
    if (!key) return false;
    sessionStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('Unable to save checkout state:', error);
    return false;
  }
}
function clearCheckoutState(user) {
  try {
    const key = getAccountStorageKey(CHECKOUT_KEY, user);
    if (!key) return false;
    sessionStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error('Unable to clear checkout state:', error);
    return false;
  }
}
// If a signed Razorpay response exists, verification must finish before retry.
function hasSavedSignedPayment(user, orderId) {
  try {
    const key = getAccountStorageKey(VERIFICATION_KEY, user);
    const raw = key ? sessionStorage.getItem(key) : null;
    if (!raw) return false;
    const details = JSON.parse(raw);
    return details?.orderId === orderId &&
      Boolean(details.razorpayOrderId &&
        details.razorpayPaymentId && details.razorpaySignature);
  } catch {
    return false;
  }
}

function readUnresolvedOrderId(user) {
  try {
    const key = getAccountStorageKey(UNRESOLVED_KEY, user);
    if (!key) return null;
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function ArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
// Reuse the branded route-loader visual for genuine payment network activity.
// Never show it over the Razorpay-hosted checkout modal.
const PAYMENT_PROGRESS = {
  preparing: {
    title: 'Preparing secure checkout',
    message: 'Getting Razorpay ready for your order…'
  },
  initiating: {
    title: 'Connecting to Razorpay',
    message: 'Checking payment status and preparing your payment…'
  },
  verifying: {
    title: 'Confirming your payment',
    message: 'Verifying with the server. Please do not pay again.'
  }
};

function PaymentProgressOverlay({ phase }) {
  const progress = PAYMENT_PROGRESS[phase];
  if (!progress) return null;

  return (
    <div className="route-loader payment-loader" role="status" aria-live="polite" aria-atomic="true">
      <div className="route-loader__card">
        <span className="route-loader__pizza" aria-hidden="true">🍕</span>
        <strong className="route-loader__heading">{progress.title}</strong>
        <span className="route-loader__message">{progress.message}</span>
        <span className="route-loader__progress" aria-hidden="true"><span /></span>
      </div>
    </div>
  );
}

function ingredientSummary(recipe) {
  const parts = [];

  if (recipe.base) parts.push('Base');
  if (recipe.sauce) parts.push('Sauce');
  if (recipe.cheese) parts.push('Cheese');

  // Vegetable toppings
  if (recipe.vegetables?.length) {
    parts.push(
      `${recipe.vegetables.length} veg`
    );
  }

  // Protein toppings
  if (recipe.proteins?.length) {
    parts.push(
      `${recipe.proteins.length} protein${
        recipe.proteins.length !== 1 ? 's' : ''
      }`
    );
  }

  return parts.join(', ');
}
export function Checkout({
  onNavigate,
  csrfToken,
  onNotice,
  user,
  onCartUpdate
}) {
  const [cart, setCart] = useState(() => cartUtils.loadCart(user));
  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [order, setOrder] = useState(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentPhase, setPaymentPhase] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [unresolvedOrderId, setUnresolvedOrderId] =
  useState(() => readUnresolvedOrderId(user));
  const [recoveryStatus, setRecoveryStatus] = useState(() =>
  loadCheckoutState(user)?.orderId ? 'checking' : 'ready'
);
  const [recoveryError, setRecoveryError] = useState('');
  const orderLock = useRef(false);
  const paymentLock = useRef(false);
  // Restore an unfinished checkout, but never trap a new cart behind an
  // already-paid order left in sessionStorage by an earlier checkout.
  useEffect(() => {
    const saved = loadCheckoutState(user);
    if (!saved?.orderId) return;

    let active = true;
    ordersApi.getOrder(saved.orderId)
      .then(existingOrder => {
        if (!active) return;

        const alreadyPaid = existingOrder.paymentStatus === 'paid' &&
          ['received', 'in_kitchen', 'sent_to_delivery']
            .includes(existingOrder.orderState);

        if (alreadyPaid) {
          // Backend status is authoritative. Keep the historical order in
          // MongoDB, but release the local checkout slot for a new cart.
          // Only remove purchased items if the saved cart snapshot matches;
          // otherwise preserve the customer's current cart unchanged.
          let cartCleaned = false;
          try {
            cartCleaned = removePurchasedItemsFromCart();
          } catch (error) {
            console.error('Paid checkout cart cleanup failed:', error);
          }

          if (!clearCheckoutState(user)) {
            setRecoveryError(
              'Your previous order is paid, but checkout recovery could not be cleared. ' +
              'Check browser storage before starting another order.'
            );
            setRecoveryStatus('blocked');
            return;
          }

          clearPaymentRecovery();
          setOrder(null);
          setPaymentSuccess(false);
          setCart(cartUtils.loadCart(user));
          setRecoveryStatus('ready');

          if (!cartCleaned) {
            onNotice?.(
              'Your previous order is already paid. Your cart was preserved; ' +
              'review its items before placing another order.'
            );
          }
          return;
        }

        // Pending or uncertain payments must remain recoverable. An expired
        // reservation is not proof that a payment failed.
        setOrder(existingOrder);
        setRecoveryStatus('ready');
      })
      .catch(error => {
        if (!active) return;
        console.error('Checkout recovery failed:', error);
        setRecoveryError(
          error.status === 404
            ? 'Your saved order could not be found. Please contact support before placing another order.'
            : 'Unable to restore your order. Check your connection and retry.'
        );
        setRecoveryStatus('blocked');
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?._id]);
  // Fetch a fresh quote whenever the cart changes.
  useEffect(() => {
    if (order || recoveryStatus !== 'ready' || cart.length === 0) {
      setQuote(null);
      return;
    }
    if (!user || !csrfToken) {
      setQuote(null);
      setQuoteError('Authentication required');
      return;
    }
    let active = true;
    setQuote(null);
    setLoadingQuote(true);
    setQuoteError('');
    catalogueApi.getQuote(
      cartUtils.cartToQuoteLines(cart),
      csrfToken
    )
      .then(result => {
        if (active) {
          setQuote(result);
        }
      })
      .catch(error => {
        if (active) {
          setQuoteError(error.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingQuote(false);
        }
      });
    return () => {
      active = false;
    };
  }, [cart, csrfToken, user, order, recoveryStatus]);
  function markUnresolved(orderId) {
    setUnresolvedOrderId(orderId);
    try {
      const key = getAccountStorageKey(UNRESOLVED_KEY, user);
if (key) {
  sessionStorage.setItem(key, orderId);
}
    } catch (error) {
      console.error(
        'Unable to save unresolved payment marker:',
        error
      );
    }
  }
  function clearPaymentRecovery() {
    try {
      const verificationKey = getAccountStorageKey(
  VERIFICATION_KEY,
  user
);
const unresolvedKey = getAccountStorageKey(
  UNRESOLVED_KEY,
  user
);
if (verificationKey) {
  sessionStorage.removeItem(verificationKey);
}
if (unresolvedKey) {
  sessionStorage.removeItem(unresolvedKey);
}
    } catch (error) {
      console.error(
        'Unable to clear payment recovery data:',
        error
      );
    }
    setUnresolvedOrderId(null);
  }
  function removePurchasedItemsFromCart() {
    const saved = loadCheckoutState(user);
    const ids = saved?.cartItemIds;
    const lines = saved?.lines;
    if (
      !Array.isArray(ids) ||
      !Array.isArray(lines) ||
      ids.length === 0 ||
      ids.length !== lines.length ||
      new Set(ids).size !== ids.length
    ) {
      return false;
    }
    const purchased = new Map(
      ids.map((id, index) => [id, lines[index]])
    );
    let mismatch = false;
    const updated = cartUtils.loadCart(user).filter(item => {
      const line = purchased.get(item.id);
      if (!line) return true;
      const recipe = line.customRecipe;
      const same =
  recipe &&
  item.quantity === line.quantity &&

  item.recipe.base === recipe.base &&
  item.recipe.sauce === recipe.sauce &&
  item.recipe.cheese === recipe.cheese &&

  // Compare vegetable selections
  JSON.stringify(item.recipe.vegetables ?? []) ===
    JSON.stringify(recipe.vegetables ?? []) &&

  // Compare protein selections
  JSON.stringify(item.recipe.proteins ?? []) ===
    JSON.stringify(recipe.proteins ?? []);
      if (!same) {
        mismatch = true;
      }
      return !same;
    });
    // Keep the existing cart if a purchased item was modified.
    if (mismatch || !cartUtils.saveCart(updated, user)) {
      return false;
    }
    setCart(updated);
    onCartUpdate?.();
    return true;
  }
  async function handlePlaceOrder() {
    if (
      orderLock.current ||
      recoveryStatus !== 'ready' ||
      order ||
      loadCheckoutState(user)?.orderId
    ) {
      onNotice(
        'Resolve your existing checkout before placing another order.'
      );
      return;
    }
    if (!quote || quoteError || loadingQuote) {
      onNotice('Please wait for your price quote.');
      return;
    }
    orderLock.current = true;
    setCreatingOrder(true);
    setOrderError('');
    try {
      const lines = ordersApi.cartToOrderLines(cart);
      const saved = loadCheckoutState(user);
      if (
        saved?.lines &&
        JSON.stringify(saved.lines) !== JSON.stringify(lines)
      ) {
        throw new Error(
          'Your cart changed after the last order attempt. ' +
          'Resolve that attempt first.'
        );
      }
      const key =
        saved?.idempotencyKey ||
        ordersApi.generateIdempotencyKey();
      // Save the order attempt before contacting the backend.
      if (
        !saved &&
        !saveCheckoutState({
          orderId: null,
          idempotencyKey: key,
          lines,
          cartItemIds: cart.map(item => item.id)
        },user)
      ) {
        throw new Error(
          'Unable to save checkout recovery information.'
        );
}
      const created = await ordersApi.createOrder(
        saved?.lines || lines,
        csrfToken,
        key
      );
      const persisted = saveCheckoutState({
        orderId: created.orderId,
        idempotencyKey: key,
        lines: saved?.lines || lines,
        cartItemIds:
          saved?.cartItemIds || cart.map(item => item.id),
        totalPricePaise: created.totalPricePaise,
        createdAt:
          created.createdAt || new Date().toISOString()
      }, user);
      setOrder(created);
      if (!persisted) {
        setPaymentError(
          'Order created, but checkout recovery could not be saved. ' +
          'Do not pay until browser storage works.'
        );
      }
      onNotice(
        created.idempotent
          ? 'Existing order restored.'
          : 'Order created successfully!'
      );
    } catch (error) {
      console.error('Order creation failed:', error);
      if (DEFINITIVE_ORDER_ERRORS.has(error.code)) {
        const cleared = clearCheckoutState(user);
        setOrderError(
          cleared
            ? `${error.message}. Correct your cart and try again.`
            : 'Order rejected, but saved checkout information could not be cleared.'
        );
      } else {
        setOrderError(
          `${error.message}. Your original submission was preserved for a safe retry.`
        );
      }
    } finally {
      orderLock.current = false;
      setCreatingOrder(false);
    }
  }
  async function handleStartAnotherOrder() {
    if (
      !order?.orderId ||
      paymentLock.current ||
      recoveryStatus !== 'ready'
    ) {
      return;
    }
    setRecoveryStatus('checking');
    try {
      const latest = await ordersApi.getOrder(order.orderId);
      setOrder(latest);
      const paymentConfirmed =
        latest.paymentStatus === 'paid' &&
        [
          'received',
          'in_kitchen',
          'sent_to_delivery'
        ].includes(latest.orderState);
      if (!paymentConfirmed) {
        onNotice(
          'Previous payment is not confirmed. ' +
          'Checkout has been preserved.'
        );
        return;
      }
      // A changed cart must not permanently trap this *paid* order in the
      // checkout slot. If items differ, preserve the cart and warn instead.
      let cartCleaned = false;
      try {
        cartCleaned = removePurchasedItemsFromCart();
      } catch (error) {
        console.error('Paid checkout cart cleanup failed:', error);
      }
      if (!clearCheckoutState(user)) {
        onNotice(
          'Unable to clear saved checkout information.'
        );
        return;
      }
      clearPaymentRecovery();
      setOrder(null);
      setPaymentSuccess(false);
      setPaymentError('');
      setQuote(null);
      setQuoteError('');
      setCart(cartUtils.loadCart(user));
      onNavigate('menu');
      onNotice(
        cartCleaned
          ? 'Previous order confirmed. You can place another order.'
          : 'Previous order confirmed. Your cart was preserved; review it before ordering again.'
      );
    } catch (error) {
      console.error(
        'Unable to start another order:',
        error
      );
      onNotice(
        'Could not confirm the previous order. ' +
        'Checkout has been preserved.'
      );
    } finally {
      setRecoveryStatus('ready');
    }
  }
  async function handleStartNewCheckout() {
    if (
      !order?.orderId ||
      orderLock.current ||
      paymentLock.current
    ) {
      return;
    }
    if (unresolvedOrderId === order.orderId) {
      onNotice(
        'Payment outcome is unresolved. ' +
        'Do not start a new checkout for this order.'
      );
      return;
    }
    setRecoveryStatus('checking');
    setRecoveryError('');
    try {
      const latest = await ordersApi.getOrder(
        order.orderId
      );
      if (
        latest.orderState !== 'expired' ||
        latest.paymentStatus !== 'pending_gateway'
      ) {
        setOrder(latest);
        onNotice(
          'This order cannot be reset. ' +
          'Its latest status has been restored.'
        );
        return;
      }
      if (!clearCheckoutState(user)) {
        throw new Error(
          'Unable to clear checkout state'
        );
      }
      setOrder(null);
      setOrderError('');
      setQuote(null);
      setQuoteError('');
      setCart(cartUtils.loadCart(user));
      onNotice(
        'Expired checkout cleared; cart preserved.'
      );
    } catch (error) {
      console.error(
        'Unable to reset checkout:',
        error
      );
      setRecoveryError(
        'Could not verify or clear the previous order. ' +
        'Checkout is preserved.'
      );
      setRecoveryStatus('blocked');
      return;
    } finally {
      // Preserve a blocked state if recovery failed.
      setRecoveryStatus(current =>
        current === 'blocked' ? 'blocked' : 'ready'
      );
    }
  }
  async function completeConfirmedPayment() {
    // The backend has already confirmed inventory commitment.
    setPaymentSuccess(true);
    setOrder(current =>
      current?.orderId === order.orderId
        ? {
            ...current,
            paymentStatus: 'paid',
            orderState:
              current.orderState === 'pending_payment'
                ? 'received'
                : current.orderState
          }
        : current
    );
    let cleaned = false;
    try {
      cleaned = removePurchasedItemsFromCart();
    } catch (error) {
      console.error(
        'Cart cleanup failed after confirmed payment:',
        error
      );
    }
    setPaymentError(
      cleaned
        ? ''
        : 'Payment confirmed, but purchased items could not be removed automatically. Review your cart.'
    );
    clearPaymentRecovery();
    try {
      setOrder(
        await ordersApi.getOrder(order.orderId)
      );
    } catch (error) {
      console.error(
        'Payment confirmed, but order refresh failed:',
        error
      );
    }
    onNotice(
      `Payment successful! Order #${order.orderId} confirmed.`
    );
  }
  async function handleVerificationResult(result) {
    if (
      result?.verified === true &&
      result.committed === true
    ) {
      await completeConfirmedPayment();
    } else if (result?.requiresResolution) {
      setPaymentError(
        'Payment was received after expiry and requires manual resolution. ' +
        'Do not pay again.'
      );
      try {
        setOrder(
          await ordersApi.getOrder(order.orderId)
        );
      } catch (error) {
        console.error(
          'Unable to refresh order status:',
          error
        );
      }
    } else {
      setPaymentError(
        'Payment verification is unresolved. ' +
        'Do not pay again; contact support.'
      );
    }
  }
  async function handleRetryPaymentVerification() {
    if (
      !order?.orderId ||
      paymentLock.current ||
      unresolvedOrderId !== order.orderId
    ) {
      return;
    }
    let details;
    try {
      const key = getAccountStorageKey(VERIFICATION_KEY, user);
const saved = key
  ? sessionStorage.getItem(key)
  : null;
      details = saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error(
        'Could not load verification details:',
        error
      );
    }
    if (
      details?.orderId !== order.orderId ||
      !details?.razorpayOrderId ||
      !details?.razorpayPaymentId ||
      !details?.razorpaySignature
    ) {
      setPaymentError(
        'Saved payment details are unavailable. ' +
        'Do not pay again; contact support with your order ID.'
      );
      return;
    }
    paymentLock.current = true;
    setPaymentBusy(true);
    setPaymentPhase('verifying');
    setPaymentError('');
    try {
      const result = await paymentsApi.verifyPayment(
        details,
        csrfToken
      );
      await handleVerificationResult(result);
    } catch (error) {
      console.error(
        'Payment verification retry failed:',
        error
      );
      setPaymentError(
        'Verification could not be completed. ' +
        'Do not pay again; retry verification or contact support.'
      );
    } finally {
      paymentLock.current = false;
      setPaymentBusy(false);
      setPaymentPhase(null);
    }
  }
  async function handleContinueToPayment() {
    if (
      !order?.orderId ||
      paymentLock.current ||
      paymentBusy
    ) {
      return;
    }
    // A saved signed response means retry verification, not a new payment.
    // For legacy unresolved markers without a signed response, the backend
    // checks Razorpay before authorizing another checkout attempt.
    if (
      unresolvedOrderId === order.orderId &&
      hasSavedSignedPayment(user, order.orderId)
    ) {
      onNotice('Verify your previous payment before attempting checkout again.');
      return;
    }
    // Do not begin a payment that cannot be recovered after refresh.
    if (
      loadCheckoutState(user)?.orderId !== order.orderId
    ) {
      setPaymentError(
        'Checkout recovery information is unavailable. ' +
        'Do not initiate payment.'
      );
      return;
    }
    paymentLock.current = true;
    setPaymentBusy(true);
    setPaymentPhase('preparing');
    setPaymentError('');
    let checkoutAttempted = false;
    let initiationUncertain = false;
    try {
      // Ensure the Razorpay script is available.
      await paymentsApi.loadRazorpayScript();
      setPaymentPhase('initiating');
      let paymentData;
      try {
        paymentData = await paymentsApi.initiatePayment(
          order.orderId,
          csrfToken
        );
        // The backend has checked that no prior gateway payment can be paid.
        if (unresolvedOrderId === order.orderId) {
          clearPaymentRecovery();
        }
      } catch (error) {
        initiationUncertain =
          UNCERTAIN_GATEWAY_ERRORS.has(error.code) ||
          error.status >= 500 ||
          error instanceof TypeError;
        throw error;
      }
      checkoutAttempted = true;
      // Hide our overlay while Razorpay's own interactive modal is open.
      setPaymentPhase(null);
      const response =
        await paymentsApi.openRazorpayCheckout({
          key: paymentData.keyId,
          amount: paymentData.amountPaise,
          currency: paymentData.currency,
          order_id: paymentData.razorpayOrderId,
          name: 'SUNNYS Pizza',
          description:
            `Payment for order ${order.orderId}`,
          prefill: {
            email: user?.email || ''
          }
        });
      // Razorpay returned a signed payment response: verify it on the backend.
      setPaymentPhase('verifying');
      const details = {
        orderId: order.orderId,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature
      };
      // Preserve the signed response for safe verification retries.
      try {
        const key = getAccountStorageKey(VERIFICATION_KEY, user);
if (!key) {
  throw new Error('Account identity is unavailable.');
}
sessionStorage.setItem(
  key,
  JSON.stringify(details)
);
      } catch (error) {
        console.error(
          'Could not save payment verification details:',
          error
        );
      }
      markUnresolved(order.orderId);
      const result = await paymentsApi.verifyPayment(
        details,
        csrfToken
      );
      await handleVerificationResult(result);
    } catch (error) {
      console.error(
        'Payment attempt did not complete:',
        error
      );
      if (error.message === 'Payment cancelled by user' && checkoutAttempted) {
        // Closing the modal does not prove payment succeeded. Server-side
        // initiation will check Razorpay again before allowing a retry.
        setPaymentError(
          'Checkout closed. You can try again while the reservation is active; ' +
          'your previous payment status will be checked first.'
        );
      } else if (checkoutAttempted || initiationUncertain) {
        markUnresolved(order.orderId);
        setPaymentError(
          'Payment outcome could not be confirmed. ' +
          'Do not pay again; retry verification or contact support.'
        );
      } else {
        setPaymentError(
          error.message || 'Unable to start payment.'
        );
      }
    } finally {
      paymentLock.current = false;
      setPaymentBusy(false);
      setPaymentPhase(null);
    }
  }
  // Authentication required.
  if (!user) {
    return (
      <main className="checkout-page shell">
        <div className="checkout-header">
          <h1 className="checkout-title">
            Checkout
          </h1>
        </div>
        <div className="checkout-empty">
          <div className="checkout-empty__icon">
            🔐
          </div>
          <h2>Authentication required</h2>
          <p>
            Please sign in to complete your order.
          </p>
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
  // Restore a saved checkout.
  if (recoveryStatus !== 'ready') {
    return (
      <main className="checkout-page shell">
        <div className="checkout-header">
          <h1 className="checkout-title">
            Restoring Checkout
          </h1>
        </div>
        <div className="checkout-empty">
          {recoveryStatus === 'checking' ? (
            <>
              <h2>
                Checking your previous order...
              </h2>
              <p>
                Retrieving order status.
              </p>
            </>
          ) : (
            <>
              <h2>
                Unable to Restore Checkout
              </h2>
              <p>{recoveryError}</p>
              <p>
                Your cart and previous checkout have been preserved.
              </p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => window.location.reload()}
              >
                Retry Recovery
              </button>
              <button
                type="button"
                className="button button--outline"
                onClick={() => onNavigate('cart')}
              >
                Back to Cart
              </button>
            </>
          )}
        </div>
      </main>
    );
  }
  // Empty cart.
  if (!order && cart.length === 0) {
    return (
      <main className="checkout-page shell">
        <div className="checkout-header">
          <h1 className="checkout-title">
            Checkout
          </h1>
        </div>
        <div className="checkout-empty">
          <div className="checkout-empty__icon">
            🛒
          </div>
          <h2>Your cart is empty</h2>
          <p>
            Add items to your cart before checking out.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => onNavigate('home')}
          >
            Browse menu <ArrowIcon />
          </button>
        </div>
      </main>
    );
  }
  // Order confirmation and payment.
  if (order) {
    const expiresAt =
      order.reservationExpiresAt ??
      order.reservation?.expiresAt;
    const expiryTimestamp = expiresAt
      ? Date.parse(expiresAt)
      : NaN;
    const expired =
      order.orderState === 'expired' ||
      (
        order.orderState === 'pending_payment' &&
        Number.isFinite(expiryTimestamp) &&
        expiryTimestamp <= Date.now()
      );
    const needsResolution =
      order.paymentStatus === 'paid_after_expiry';
    const confirmed =
      paymentSuccess ||
      (
        order.paymentStatus === 'paid' &&
        order.orderState !== 'expired'
      );
    const canPay =
      order.orderState === 'pending_payment' &&
      ['pending_gateway', 'created'].includes(
        order.paymentStatus
      ) &&
      Number.isFinite(expiryTimestamp) &&
      expiryTimestamp > Date.now();
    const unresolved =
      unresolvedOrderId === order.orderId;
    const totalItems =
      order.items?.reduce(
        (sum, item) => sum + item.quantity,
        0
      ) || 0;
    return (
      <main className="checkout-page shell">
        <PaymentProgressOverlay phase={paymentPhase} />
        <div className="checkout-header">
          <h1 className="checkout-title">
            Order Confirmation
          </h1>
        </div>
        <div
          className={`order-confirmation ${
            paymentSuccess ? 'payment-success' : ''
          }`}
        >
          <div className="order-confirmation__icon">
            {paymentSuccess ? '🎉' : '✓'}
          </div>
          <h2>
            {paymentSuccess
              ? 'Payment Successful!'
              : needsResolution
                ? 'Payment Requires Resolution'
                : confirmed
                  ? 'Payment Confirmed!'
                  : expired
                    ? 'Reservation Expired'
                    : 'Order Created — Awaiting Payment'}
          </h2>
          <p className="order-id">
            Order ID: <strong>{order.orderId}</strong>
          </p>
          {paymentSuccess && (
            <div className="checkout-notice checkout-notice--success">
              <p>
                Thank you for your order! Your payment is confirmed
                and your pizzas are being prepared.
              </p>
            </div>
          )}
          {paymentError && (
            <div className="checkout-notice checkout-notice--error">
              <p>{paymentError}</p>
            </div>
          )}
          <div className="order-details">
            <div className="order-detail-row">
              <span>Status:</span>
              <span
                className={`order-status ${
                  confirmed ? 'order-status--confirmed' : ''
                }`}
              >
                {order.orderState}
              </span>
            </div>
            <div className="order-detail-row">
              <span>Payment:</span>
              <span
                className={`payment-status ${
                  confirmed ? 'payment-status--paid' : ''
                }`}
              >
                {order.paymentStatus}
              </span>
            </div>
            {expiresAt && !confirmed && (
              <div className="order-detail-row">
                <span>Reservation expires:</span>
                <span>
                  {Number.isFinite(expiryTimestamp)
                    ? new Date(expiryTimestamp).toLocaleString()
                    : 'Unavailable'}
                </span>
              </div>
            )}
            <div className="order-detail-row">
              <span>Items:</span>
              <span>
                {totalItems} item{totalItems !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="order-detail-row order-total">
              <span>Total:</span>
              <span>
                {catalogueApi.formatPrice(
                  order.totalPricePaise
                )}
              </span>
            </div>
          </div>
          <div className="order-items-summary">
            <h3>Order Items</h3>
            {order.items?.map((item, index) => (
              <div
                key={index}
                className="order-item-row"
              >
                <span className="order-item-name">
                  {item.name}
                </span>
                <span className="order-item-qty">
                  ×{item.quantity}
                </span>
                <span className="order-item-price">
                  {catalogueApi.formatPrice(
                    item.lineTotalPaise
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="order-actions">
            {canPay && !paymentSuccess && (
              <button
                type="button"
                className="button button--primary button--full"
                onClick={handleContinueToPayment}
                disabled={paymentBusy || (unresolved && hasSavedSignedPayment(user, order.orderId))}
              >
                {paymentBusy
                  ? paymentPhase === 'verifying'
                    ? 'Confirming Payment...'
                    : paymentPhase
                      ? 'Connecting to Razorpay...'
                      : 'Complete Payment in Razorpay'
                  : unresolved ? 'Check Status & Retry Payment' : 'Continue to Payment'}
                {paymentBusy && paymentPhase ? (
                  <span className="payment-button__spinner" aria-hidden="true" />
                ) : !paymentBusy ? <ArrowIcon /> : null}
              </button>
            )}
            {unresolved && (
              <div
                role="alert"
                className="checkout-notice"
              >
                <p>
                  {hasSavedSignedPayment(user, order.orderId)
                    ? 'Payment verification is unresolved. Verify it before paying again.'
                    : 'The previous payment needs a gateway status check before retry.'}
                </p>
              </div>
            )}
            {unresolved && !confirmed && !paymentSuccess &&
              hasSavedSignedPayment(user, order.orderId) && (
              <button
                type="button"
                className="button button--outline button--full"
                onClick={handleRetryPaymentVerification}
                disabled={paymentBusy}
              >
                {paymentBusy && paymentPhase === 'verifying' && (
                  <span className="payment-button__spinner" aria-hidden="true" />
                )}
                {paymentBusy
                  ? 'Verifying Payment...'
                  : 'Retry Payment Verification'}
              </button>
            )}
            {order.orderState === 'expired' &&
              order.paymentStatus === 'pending_gateway' &&
              !unresolved && (
                <button
                  type="button"
                  className="button button--outline button--full"
                  onClick={handleStartNewCheckout}
                  disabled={paymentBusy}
                >
                  Start New Checkout
                </button>
              )}
            {(confirmed || paymentSuccess) &&
              !needsResolution && (
                <button
                  type="button"
                  className="button button--primary button--full"
                  onClick={handleStartAnotherOrder}
                  disabled={paymentBusy}
                >
                  Start Another Order <ArrowIcon />
                </button>
              )}
            <button
              type="button"
              className="button button--outline button--full"
              onClick={() => onNavigate('home')}
            >
              Return to Menu
            </button>
          </div>
          <div className="checkout-notice">
            {needsResolution ? (
              <p>
                Payment arrived after reservation expiry and
                requires manual resolution. Do not pay again.
              </p>
            ) : unresolved && !confirmed ? (
              <p>
                Payment status is unresolved. Do not start
                another payment; retry verification or
                contact support.
              </p>
            ) : confirmed ? (
              <p>
                Payment confirmed. Your order is being processed.
              </p>
            ) : expired ? (
              <p>
                Reservation expired; payment is unavailable.
                Your cart is preserved.
              </p>
            ) : (
              <p>
                Your order is awaiting payment. Select
                "Continue to Payment" before your reservation expires.
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }
  // Checkout review.
  const totalItems = cartUtils.getCartItemCount(cart);
  const total =
    loadingQuote || quoteError || !quote
      ? '—'
      : catalogueApi.formatPrice(quote.totalPaise);
  return (
    <main className="checkout-page shell">
      <div className="checkout-header">
        <button
          type="button"
          onClick={() => onNavigate('cart')}
          className="back-link"
        >
          ← Back to cart
        </button>
        <h1 className="checkout-title">
          Review Your Order
        </h1>
        <p className="checkout-subtitle">
          {totalItems} item{totalItems !== 1 ? 's' : ''} •
          Please review before placing your order
        </p>
      </div>
      <div className="checkout-layout">
        <div className="checkout-items">
          <h2>Order Items</h2>
          {cart.map((item, index) => {
            const line = quote?.lines?.[index];
            return (
              <div
                key={item.id}
                className="checkout-item"
              >
                <div className="checkout-item__info">
                  <h3 className="checkout-item__name">
                    {item.name}
                  </h3>
                  <p className="checkout-item__details">
                    {ingredientSummary(item.recipe)}
                    {' • '}
                    Quantity: {item.quantity}
                  </p>
                </div>
                <div className="checkout-item__price">
                  {loadingQuote ? (
                    <span className="price-loading">
                      ...
                    </span>
                  ) : quoteError ? (
                    <span className="price-error">
                      —
                    </span>
                  ) : line ? (
                    <>
                      <span className="price-unit">
                        {catalogueApi.formatPrice(
                          line.unitPricePaise
                        )} each
                      </span>
                      <span className="price-line">
                        {catalogueApi.formatPrice(
                          line.lineTotalPaise
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="price-loading">
                      —
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="checkout-summary">
          <h2>Order Summary</h2>
          {quoteError && (
            <div className="checkout-error">
              <p>
                <strong>Error:</strong> {quoteError}
              </p>
            </div>
          )}
          {orderError && (
            <div className="checkout-error">
              <p>
                <strong>Order Error:</strong> {orderError}
              </p>
            </div>
          )}
          <div className="checkout-summary__totals">
            <div className="checkout-summary__row">
              <span>
                Subtotal ({totalItems} item
                {totalItems !== 1 ? 's' : ''})
              </span>
              <span>
                {loadingQuote ? 'Calculating...' : total}
              </span>
            </div>
            <div className="checkout-summary__row checkout-summary__total">
              <span>Total</span>
              <span>
                {loadingQuote ? 'Calculating...' : total}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="button button--primary button--full checkout-submit"
            onClick={handlePlaceOrder}
            disabled={
              creatingOrder ||
              loadingQuote ||
              !!quoteError ||
              !quote ||
              recoveryStatus !== 'ready'
            }
          >
            {creatingOrder
              ? 'Placing Order...'
              : 'Place Order'}
            {!creatingOrder && <ArrowIcon />}
          </button>
          <button
            type="button"
            className="button button--outline button--full"
            onClick={() => onNavigate('cart')}
            disabled={creatingOrder}
          >
            Back to Cart
          </button>
          <div
            className="checkout-notice"
            style={{ marginTop: '20px' }}
          >
            <p
              style={{
                fontSize: '12px',
                lineHeight: '1.6',
                color: 'var(--text-muted)'
              }}
            >
              Placing this order reserves ingredients.
              Payment is required to complete your order.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
