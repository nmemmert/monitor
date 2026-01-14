import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatLocalTime } from './utils/timeUtils';

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
    <div className="container" style={{ paddingTop: '2rem' }}>
      <h2>📬 Notifications</h2>
      
      <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
        <p style={{ textAlign: 'center', color: '#999' }}>Loading...</p>
      ) : notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#999' }}>
          <p>No {filter === 'unread' ? 'unread ' : filter === 'read' ? 'read ' : ''}notifications</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            {notifications.map((notification) => (
              <div
                key={notification.id}
                style={{
                  padding: '1rem',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  backgroundColor: notification.read ? 'white' : '#f0f8ff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '1rem'
                }}
              >
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>{notification.title}</h4>
                  <p style={{ margin: '0 0 0.5rem 0', color: '#666', fontSize: '0.95rem' }}>
                    {notification.message}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: '#999', flexWrap: 'wrap' }}>
                    {notification.resource_name && (
                      <span style={{ backgroundColor: '#f0f0f0', padding: '0.25rem 0.5rem', borderRadius: '3px' }}>
                        📌 {notification.resource_name}
                      </span>
                    )}
                    <span>⏰ {formatLocalTime(notification.created_at)}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  {!notification.read && (
                    <button
                      className="btn btn-sm"
                      onClick={() => handleMarkAsRead(notification.id)}
                      title="Mark as read"
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                    >
                      ✓ Read
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(notification.id)}
                    title="Delete"
                    style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', background: '#dc3545' }}
                  >
                    ✕ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
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
