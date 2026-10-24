import { useEffect, useState } from 'react';

/**
 * The last error of a query until it delivers data again. TanStack Query clears
 * `error` (and goes back to "pending") whenever a query without data refetches,
 * which would make error views flash back to the loading state on every poll.
 */
export function useStickyError(error: Error | null, hasData: boolean): Error | null {
  const [lastError, setLastError] = useState<Error | null>(null);

  useEffect(() => {
    if (error) setLastError(error);
    else if (hasData) setLastError(null);
  }, [error, hasData]);

  return error ?? (hasData ? null : lastError);
}
