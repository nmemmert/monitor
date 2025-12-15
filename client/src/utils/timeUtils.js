/**
 * Utility functions for handling time display with proper timezone support
 */

/**
 * Get the current system timezone
 */
export const getCurrentTimezone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Format a timestamp to local time string with timezone info
 * Uses server timezone from localStorage if available, otherwise browser timezone
 */
export const formatLocalTime = (timestamp, options = {}) => {
  if (!timestamp) return 'Never';
  
  const date = new Date(timestamp);
  
  // Try to get server timezone from settings API response (cached in localStorage)
  let timeZone;
  try {
    const cachedSettings = localStorage.getItem('serverTimezone');
    if (cachedSettings && cachedSettings !== 'null' && cachedSettings !== 'undefined') {
      timeZone = cachedSettings;
    }
  } catch (e) {
    // Ignore errors
  }
  
  const defaultOptions = {
    year: 'numeric',
    month: 'short', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  };
  
  if (timeZone) {
    defaultOptions.timeZone = timeZone;
  }
  
  return date.toLocaleString('en-US', { ...defaultOptions, ...options });
};

/**
 * Format a timestamp to time only with timezone
 */
export const formatLocalTimeOnly = (timestamp, options = {}) => {
  if (!timestamp) return 'Never';
  
  const date = new Date(timestamp);
  const defaultOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  };
  
  return date.toLocaleTimeString('en-US', { ...defaultOptions, ...options });
};

/**
 * Format timestamp for chart display (shorter format)
 */
export const formatChartTime = (timestamp) => {
  if (!timestamp) return '';
  
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
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