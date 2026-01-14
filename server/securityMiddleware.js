const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = 3600; // 1 hour
const REFRESH_TOKEN_EXPIRY = 86400 * 7; // 7 days

class SecurityMiddleware {
  // Generate JWT token
  generateToken(payload, expiresIn = JWT_EXPIRY) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  }

  // Generate refresh token
  generateRefreshToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return null;
    }
  }

  // Verify refresh token
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // Additional validation: check if it's a refresh token (has longer expiry)
      if (decoded.exp - decoded.iat < REFRESH_TOKEN_EXPIRY - 100) {
        return null; // Not a refresh token
      }
      return decoded;
    } catch (err) {
      return null;
    }
  }

  // Verify token expiry
  isTokenExpired(token) {
    const decoded = this.verifyToken(token);
    if (!decoded) return true;
    return false;
  }

  // Generate CSRF token (alias for compatibility)
  generateCSRFToken() {
    return this.generateCsrfToken();
  }

  // Generate CSRF token
  generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Verify CSRF token
  verifyCsrfToken(token, sessionToken) {
    if (!token || !sessionToken) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(sessionToken));
  }

  // Hash password with salt
  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // Validate password strength
  validatePasswordStrength(password) {
    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters' };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }
    if (!/[a-z]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one digit' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one special character' };
    }
    return { valid: true };
  }

  // Middleware to verify CSRF
  csrfMiddleware(req, res, next) {
    const token = req.headers['x-csrf-token'] || req.body.csrfToken;
    const sessionToken = req.session?.csrfToken;
    
    if (!this.verifyCsrfToken(token, sessionToken)) {
      return res.status(403).json({ error: 'CSRF token validation failed' });
    }
    next();
  }

  // Middleware to verify JWT
  jwtMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const decoded = this.verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;
    next();
  }
}

module.exports = new SecurityMiddleware();
