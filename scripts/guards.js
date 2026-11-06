// Stripe sandbox guard. Only a test-mode publishable key allows payment steps.
// Anything else, including "cannot tell", means skip.
export function stripeKeyMode(key) {
  const k = String(key ?? "").trim();
  if (/^pk_test_[A-Za-z0-9]+$/.test(k)) return "test";
  if (/^pk_live_[A-Za-z0-9]+$/.test(k)) return "live";
  return "unknown";
}

export function mayRunPaymentStep(key) {
  return stripeKeyMode(key) === "test";
}
