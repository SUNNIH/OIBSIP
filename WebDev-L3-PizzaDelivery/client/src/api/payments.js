// SUNNYS Pizza — Payments API Client

const API_BASE = '/api/v1/payments';

const RAZORPAY_SCRIPT_URL =
  'https://checkout.razorpay.com/v1/checkout.js';

let razorpayScriptPromise = null;

// Handle payment API responses and preserve backend errors.
async function handlePaymentResponse(response, fallbackMessage) {
  let data;

  try {
    data = await response.json();
  } catch {
    const error = new Error('Unable to read payment server response');
    error.status = response.status;
    error.code = 'INVALID_RESPONSE';
    throw error;
  }

  if (!response.ok) {
    const message =
      (typeof data?.error === 'string'
        ? data.error
        : data?.error?.message) || fallbackMessage;

    const error = new Error(message);

    error.status = response.status;
    error.code = data?.error?.code || 'HTTP_ERROR';

    throw error;
  }

  return data;
}

// Create or retrieve a Razorpay order through the backend.
export async function initiatePayment(orderId, csrfToken) {
  const response = await fetch(`${API_BASE}/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify({ orderId })
  });

  return handlePaymentResponse(
    response,
    'Failed to initiate payment'
  );
}

// Verify a completed Razorpay payment with the backend.
export async function verifyPayment(paymentDetails, csrfToken) {
  const response = await fetch(`${API_BASE}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify(paymentDetails)
  });

  return handlePaymentResponse(
    response,
    'Payment verification failed'
  );
}

// Load Razorpay Checkout once and reuse any pending load.
export function loadRazorpayScript() {
  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }

  razorpayScriptPromise = new Promise((resolve, reject) => {
    // Replace an existing script whose load state is unknown.
    const existingScript = document.querySelector(
      `script[src="${RAZORPAY_SCRIPT_URL}"]`
    );

    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement('script');

    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;

    script.onload = () => {
      if (window.Razorpay) {
        resolve(true);
      } else {
        script.remove();
        reject(new Error('Razorpay unavailable after script load'));
      }
    };

    script.onerror = () => {
      script.remove();
      reject(new Error('Failed to load Razorpay script'));
    };

    document.head.appendChild(script);
  }).catch(error => {
    // Allow another attempt if loading fails.
    razorpayScriptPromise = null;
    throw error;
  });

  return razorpayScriptPromise;
}

// Open Razorpay Checkout and return successful payment details.
export function openRazorpayCheckout(options) {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error('Razorpay not loaded'));
      return;
    }

    const razorpay = new window.Razorpay({
      ...options,

      handler: response => {
        resolve(response);
      },

      modal: {
        ondismiss: () => {
          reject(new Error('Payment cancelled by user'));
        }
      }
    });

    // Razorpay may allow another payment attempt in the same modal.
    // Wait for success or dismissal before settling the Promise.
    razorpay.on('payment.failed', response => {
      console.warn(
        'Razorpay payment attempt failed:',
        response.error?.description || 'Payment attempt failed'
      );
    });

    razorpay.open();
  });
}