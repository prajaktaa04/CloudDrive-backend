function errorHandler(err, req, res, next) {
  // If the response has already started, let Express handle it.
  if (res.headersSent) {
    return next(err);
  }

  const status =
    Number.isInteger(err?.status) && err.status >= 400
      ? err.status
      : 500;

  const code =
    err?.code ||
    (status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR');

  const message =
    err?.message ||
    'Something went wrong.';

  /*
   * 401/403 are expected application responses.
   * Do not print them as server errors in the terminal.
   */
  if (status >= 500) {
    console.error('Server error:', err);
  } else if (status !== 401 && status !== 403) {
    console.warn(`${status} ${code}: ${message}`);
  }

  return res.status(status).json({
    error: {
      code,
      message
    }
  });
}

module.exports = errorHandler;