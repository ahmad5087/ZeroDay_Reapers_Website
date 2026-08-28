export const AUTH_OPERATION_TIMEOUT_MS = 20_000;

export class AuthOperationTimeoutError extends Error {
  constructor() {
    super("Authentication timed out");
    this.name = "AuthOperationTimeoutError";
  }
}

// Supabase auth operations have historically been able to remain pending when a
// browser auth lock or network request gets wedged. Never leave the UI in a
// permanent loading state even if the SDK promise does not settle.
export function withAuthTimeout(operation, timeoutMs = AUTH_OPERATION_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AuthOperationTimeoutError()), timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

export function authErrorMessage(error, action = "Authentication") {
  const message = typeof error?.message === "string" ? error.message : "";
  const timedOut = error instanceof AuthOperationTimeoutError
    || error?.name === "AbortError"
    || /auth(?:entication)?(?: request)? timed out|operation timed out|signal is aborted/i.test(message);

  if (timedOut) {
    return `${action} service did not respond in time. Wait a moment, complete the captcha again, and retry.`;
  }

  // auth-js wraps fetch failures (including gateway outages and CORS/network
  // interruptions) as AuthRetryableFetchError with status 0.
  if (error?.name === "AuthRetryableFetchError" || error?.status === 0 || /failed to fetch|networkerror/i.test(message)) {
    return `${action} service is temporarily unreachable. Check your connection, complete the captcha again, and retry.`;
  }
  return message || `${action} failed. Please retry.`;
}
