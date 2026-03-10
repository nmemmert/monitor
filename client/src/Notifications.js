import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatLocalTime } from './utils/timeUtils';
import './CommandCenterPages.css';

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const itemsPerPage = 50;

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 10000);
    
    // Connect to WebSocket for real-time updates
    connectWebSocket();
    
    return () => {
      clearInterval(interval);
      if (window.notificationWebSocket) {
        window.notificationWebSocket.close();
      }
    };
  }, [filter, currentPage]);

  const connectWebSocket = () => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}`);
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'notification') {
            loadNotifications();
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      ws.onclose = () => {
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
      const params = {
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage
      };
      if (filter === 'unread') params.read = 'unread';
      if (filter === 'read') params.read = 'read';

      const response = await axios.get('/api/notifications', { params });
      setNotifications(response.data.notifications);
      setUnreadCount(response.data.unreadCount);
      setTotal(response.data.total);
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
      setCurrentPage(1);
      loadNotifications();
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  const totalPages = Math.ceil(total / itemsPerPage);

  return (
    <div className="container cc-page">
      <div className="cc-page-header">
        <h2 className="cc-page-title">Notifications</h2>
      </div>
      
      <div className="cc-controls" style={{ marginBottom: '1rem' }}>
        <div className="cc-controls">
          <button
            className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setFilter('all'); setCurrentPage(1); }}
          >
            All ({total})
          </button>
          <button
            className={`btn ${filter === 'unread' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setFilter('unread'); setCurrentPage(1); }}
          >
            Unread ({unreadCount})
          </button>
          <button
            className={`btn ${filter === 'read' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setFilter('read'); setCurrentPage(1); }}
          >
            Read ({total - unreadCount})
          </button>
        </div>
        
        {notifications.length > 0 && (
          <button
            className="btn btn-danger"
            onClick={handleClearAll}
            style={{ marginLeft: 'auto' }}
          >
            Clear All
          </button>
        )}
      </div>

      {loading ? (
        <p className="cc-empty">Loading...</p>
      ) : notifications.length === 0 ? (
        <div className="cc-empty">
          <p>No {filter === 'unread' ? 'unread ' : filter === 'read' ? 'read ' : ''}notifications</p>
        </div>
      ) : (
        <>
          <div className="notifications-list">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`notification-row ${notification.read ? 'is-read' : 'is-unread'}`}
              >
                <div className="notification-content">
                  <h4 className="notification-title">{notification.title}</h4>
                  <p className="notification-message">
                    {notification.message}
                  </p>
                  <div className="notification-meta">
                    {notification.resource_name && (
                      <span className="notification-chip">
                        {notification.resource_name}
                      </span>
                    )}
                    <span>{formatLocalTime(notification.created_at)}</span>
                  </div>
                </div>

                <div className="notification-actions">
                  {!notification.read && (
                    <button
                      className="btn btn-sm"
                      onClick={() => handleMarkAsRead(notification.id)}
                      title="Mark as read"
                    >
                      ✓ Read
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(notification.id)}
                    title="Delete"
                    style={{ background: '#b91c1c' }}
                  >
                    ✕ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="cc-pagination">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  className={`btn ${currentPage === page ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCurrentPage(page)}
                  style={{ minWidth: '40px' }}
                >
                  {page}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Notifications;
