/**
 * Utility functions for handling time display with proper timezone support
 */

/**
 * Get the current system timezone
 */
export const getCurrentTimezone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

const getServerTimezone = () => {
  try {
    const tz = localStorage.getItem('serverTimezone');
    const ts = localStorage.getItem('serverTimezoneTime');
    if (tz && ts && (Date.now() - parseInt(ts)) < 3600000 && tz !== 'null' && tz !== 'undefined' && tz.trim() !== '') {
      return tz.replace(/^["']|["']$/g, '').trim();
    }
    if (tz) {
      localStorage.removeItem('serverTimezone');
      localStorage.removeItem('serverTimezoneTime');
    }
  } catch (_) {}
  return null;
};

/**
 * Format a timestamp to local time string with timezone info
 * Uses server timezone from localStorage if available, otherwise browser timezone
 */
export const formatLocalTime = (timestamp, options = {}) => {
  if (!timestamp) return 'Never';
  
  // Normalize timestamp to ISO if backend returned space-separated datetime
  let ts = timestamp;
  if (typeof ts === 'string' && ts.includes(' ') && !ts.includes('T')) {
    ts = ts.replace(' ', 'T') + 'Z';
  }
  
  const date = new Date(ts);
  const tz = getServerTimezone();

  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {})
  };

  return date.toLocaleString('en-US', { ...defaultOptions, ...options });
};

/**
 * Format a timestamp to time only with timezone
 */
export const formatLocalTimeOnly = (timestamp, options = {}) => {
  if (!timestamp) return 'Never';

  const date = new Date(timestamp);
  const tz = getServerTimezone();
  const defaultOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {})
  };

  return date.toLocaleTimeString('en-US', { ...defaultOptions, ...options });
};

/**
 * Format timestamp for chart display (shorter format)
 * Shows date and time for better context
 */
export const formatChartTime = (timestamp) => {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  const tz = getServerTimezone();
  const tzOpt = tz ? { timeZone: tz } : {};

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', ...tzOpt });
  }

  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...tzOpt });
};

/**
 * Get timezone info for display
 */
export const getTimezoneInfo = () => {
  const tz = getCurrentTimezone();
  const now = new Date();
  const tzDisplay = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();

  return {
    timezone: tz,
    abbreviation: tzDisplay,
    offset: now.getTimezoneOffset()
  };
};

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}