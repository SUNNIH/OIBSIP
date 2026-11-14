/**
 * Global error handler middleware
 * Sanitizes error responses to prevent information leakage
 */
export const errorHandler = (err, req, res, next) => {
  // Log full error server-side (with sensitive data redacted)
  const sanitizedError = { ...err };
  if (sanitizedError.stack) {
    // Redact potential sensitive paths from stack traces
    sanitizedError.stack = sanitizedError.stack.replace(/\/Users\/[^/]+/g, '/Users/***');
    sanitizedError.stack = sanitizedError.stack.replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***');
  }
  
  console.error('Error:', sanitizedError.message);
  if (process.env.NODE_ENV === 'development') {
    console.error('Stack:', sanitizedError.stack);
  }

  // Handle Multer file size limit errors
if (err.code === 'LIMIT_FILE_SIZE') {
  return res.status(400).json({
    error: {
      code: 'FILE_TOO_LARGE',
      message: 'Image exceeds the maximum allowed size'
    }
  });
}

  // Send generic error response
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
