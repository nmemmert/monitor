import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatLocalTime } from './utils/timeUtils';
import './NotificationCenter.css';

function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCenter, setShowCenter] = useState(false);
  const [filter, setFilter] = useState('all'); // all, unread, read
  const [loading, setLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    loadNotifications();
    // Refresh every 10 seconds
    const interval = setInterval(loadNotifications, 10000);
    
    // Connect to WebSocket for real-time updates
    connectWebSocket();
    
    return () => {
      clearInterval(interval);
      if (window.notificationWebSocket) {
        window.notificationWebSocket.close();
      }
    };
  }, [filter]);

  const connectWebSocket = () => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}`);
      
      ws.onopen = () => {
        console.log('WebSocket connected for real-time notifications');
        setWsConnected(true);
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'notification') {
            // New notification received - reload notifications
            loadNotifications();
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        // Attempt to reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
      };
      
      window.notificationWebSocket = ws;
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === 'unread') params.read = 'unread';
      if (filter === 'read') params.read = 'read';
      params.limit = 100;

      const response = await axios.get('/api/notifications', { params });
      setNotifications(response.data.notifications);
      setUnreadCount(response.data.unreadCount);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      await axios.put(`/api/notifications/${notificationId}/read`);
      loadNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const handleDelete = async (notificationId) => {
    try {
      await axios.delete(`/api/notifications/${notificationId}`);
      loadNotifications();
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm(`Clear all ${filter} notifications?`)) return;
    
    try {
      await axios.post('/api/notifications/clear', { type: filter });
      loadNotifications();
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  return (
    <div className="notification-center">
      {/* Notification Bell Icon */}
      <div className="notification-bell-container">
        <button
          className="notification-bell"
          onClick={() => setShowCenter(!showCenter)}
          title={`${unreadCount} unread notifications`}
        >
          🔔
          {unreadCount > 0 && (
            <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </button>
      </div>

      {/* Notification Center Popup */}
      {showCenter && (
        <div className="notification-popup">
          <div className="notification-header">
            <h3>Notifications</h3>
            <button
              className="close-btn"
              onClick={() => setShowCenter(false)}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="notification-filters">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`filter-btn ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              Unread ({unreadCount})
            </button>
            <button
              className={`filter-btn ${filter === 'read' ? 'active' : ''}`}
              onClick={() => setFilter('read')}
            >
              Read
            </button>
            {notifications.length > 0 && (
              <button
                className="filter-btn clear-btn"
                onClick={handleClearAll}
              >
                Clear All
              </button>
            )}
          </div>

          <div className="notification-list">
            {loading ? (
              <p style={{ textAlign: 'center', color: '#999', padding: '1rem' }}>Loading...</p>
            ) : notifications.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#999', padding: '1rem' }}>
                No {filter === 'unread' ? 'unread ' : filter === 'read' ? 'read ' : ''}notifications
              </p>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item ${notification.read ? 'read' : 'unread'}`}
                >
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-meta">
                      {notification.resource_name && (
                        <span className="notification-resource">
                          Resource: {notification.resource_name}
                        </span>
                      )}
                      <span className="notification-time">
                        {formatLocalTime(notification.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className="notification-actions">
                    {!notification.read && (
                      <button
                        className="action-btn mark-read"
                        onClick={() => handleMarkAsRead(notification.id)}
                        title="Mark as read"
                      >
                        ✓
                      </button>
                    )}
                    <button
                      className="action-btn delete"
                      onClick={() => handleDelete(notification.id)}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
