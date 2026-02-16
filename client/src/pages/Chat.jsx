import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';
import './Chat.css';

const API_URL = 'http://localhost:5000/api';

const Chat = () => {
  const { user } = useAuth();
  const { socket, isConnected } = useSocket();
  
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        setNotificationsEnabled(true);
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          setNotificationsEnabled(permission === 'granted');
        });
      }
    }
  }, []);

  // Show browser notification
  const showNotification = useCallback((title, body, conversationId) => {
    if (!notificationsEnabled || document.hasFocus()) return;
    
    const notification = new Notification(title, {
      body,
      icon: '/vite.svg',
      tag: conversationId,
      renotify: true
    });

    notification.onclick = () => {
      window.focus();
      const conv = conversations.find(c => c._id === conversationId);
      if (conv) setActiveConversation(conv);
      notification.close();
    };
  }, [notificationsEnabled, conversations]);

  // Fetch conversations
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const res = await axios.get(`${API_URL}/conversations`);
        setConversations(res.data.conversations);
      } catch (error) {
        console.error('Failed to fetch conversations:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchConversations();
  }, []);

  // Fetch unread counts
  useEffect(() => {
    const fetchUnreadCounts = async () => {
      try {
        const res = await axios.get(`${API_URL}/conversations/unread`);
        setUnreadCounts(res.data.counts);
      } catch (error) {
        console.error('Failed to fetch unread counts:', error);
      }
    };
    fetchUnreadCounts();
  }, []);

  // Fetch users for new chats
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get(`${API_URL}/users`);
        setUsers(res.data.users);
      } catch (error) {
        console.error('Failed to fetch users:', error);
      }
    };
    fetchUsers();
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('new_message', (message) => {
      if (activeConversation && message.conversation === activeConversation._id) {
        setMessages(prev => [...prev, message]);
        // Mark as read automatically if viewing the conversation
        socket.emit('mark_as_read', {
          conversationId: activeConversation._id,
          messageIds: [message._id]
        });
      } else {
        // Increment unread count for this conversation
        setUnreadCounts(prev => ({
          ...prev,
          [message.conversation]: (prev[message.conversation] || 0) + 1
        }));
      }
      // Update conversation list
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c._id === message.conversation) {
            return { ...c, lastMessage: message, updatedAt: new Date() };
          }
          return c;
        });
        return updated.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      });
    });

    socket.on('message_notification', ({ conversationId, message }) => {
      if (!activeConversation || conversationId !== activeConversation._id) {
        // Show browser notification
        const conv = conversations.find(c => c._id === conversationId);
        const senderName = message.sender?.username || 'Someone';
        const convName = conv?.isGroup ? conv.name : senderName;
        showNotification(
          convName,
          `${conv?.isGroup ? senderName + ': ' : ''}${message.content}`,
          conversationId
        );

        setUnreadCounts(prev => ({
          ...prev,
          [conversationId]: (prev[conversationId] || 0) + 1
        }));

        setConversations(prev => {
          const updated = prev.map(c => {
            if (c._id === conversationId) {
              return { ...c, lastMessage: message, updatedAt: new Date() };
            }
            return c;
          });
          return updated.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        });
      }
    });

    socket.on('user_typing', ({ conversationId, userId, username, isTyping }) => {
      if (activeConversation && conversationId === activeConversation._id) {
        setTypingUsers(prev => {
          if (isTyping) {
            return { ...prev, [userId]: username };
          } else {
            const { [userId]: _, ...rest } = prev;
            return rest;
          }
        });
      }
    });

    socket.on('messages_read', ({ conversationId, messageIds, readBy }) => {
      if (activeConversation && conversationId === activeConversation._id) {
        setMessages(prev => prev.map(msg => {
          if (messageIds.includes(msg._id)) {
            const existingReadBy = msg.readBy || [];
            if (!existingReadBy.some(r => r._id === readBy._id || r === readBy._id)) {
              return { ...msg, readBy: [...existingReadBy, readBy] };
            }
          }
          return msg;
        }));
      }
    });

    socket.on('user_online', ({ userId }) => {
      setUsers(prev => prev.map(u => 
        u._id === userId ? { ...u, isOnline: true } : u
      ));
      setConversations(prev => prev.map(c => ({
        ...c,
        participants: c.participants.map(p =>
          p._id === userId ? { ...p, isOnline: true } : p
        )
      })));
    });

    socket.on('user_offline', ({ userId }) => {
      setUsers(prev => prev.map(u => 
        u._id === userId ? { ...u, isOnline: false } : u
      ));
      setConversations(prev => prev.map(c => ({
        ...c,
        participants: c.participants.map(p =>
          p._id === userId ? { ...p, isOnline: false } : p
        )
      })));
    });

    return () => {
      socket.off('new_message');
      socket.off('message_notification');
      socket.off('user_typing');
      socket.off('messages_read');
      socket.off('user_online');
      socket.off('user_offline');
    };
  }, [socket, activeConversation, conversations, showNotification]);

  // Join conversation room when active conversation changes
  useEffect(() => {
    if (socket && activeConversation) {
      socket.emit('join_conversation', activeConversation._id);
      
      // Clear unread count for this conversation
      setUnreadCounts(prev => {
        const { [activeConversation._id]: _, ...rest } = prev;
        return rest;
      });
      
      // Mark all messages as read via API
      axios.post(`${API_URL}/conversations/${activeConversation._id}/read`)
        .catch(err => console.error('Failed to mark as read:', err));
      
      return () => {
        socket.emit('leave_conversation', activeConversation._id);
      };
    }
  }, [socket, activeConversation]);

  // Fetch messages when conversation changes
  useEffect(() => {
    if (!activeConversation) return;

    const fetchMessages = async () => {
      try {
        const res = await axios.get(`${API_URL}/conversations/${activeConversation._id}/messages`);
        setMessages(res.data.messages);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      }
    };
    fetchMessages();
    setTypingUsers({});
  }, [activeConversation]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket || !activeConversation) return;

    socket.emit('send_message', {
      conversationId: activeConversation._id,
      content: newMessage.trim()
    });
    setNewMessage('');
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Check file size (25MB max)
      if (file.size > 25 * 1024 * 1024) {
        alert('File size must be less than 25MB');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile || !activeConversation) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    if (newMessage.trim()) {
      formData.append('content', newMessage.trim());
    }

    try {
      await axios.post(
        `${API_URL}/conversations/${activeConversation._id}/upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' }
        }
      );
      setSelectedFile(null);
      setNewMessage('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('File upload failed:', error);
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const cancelFileSelection = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (fileType) => {
    switch (fileType) {
      case 'image': return '🖼️';
      case 'video': return '🎬';
      case 'audio': return '🎵';
      case 'document': return '📄';
      default: return '📎';
    }
  };

  const handleTyping = (e) => {
    setNewMessage(e.target.value);
    
    if (!socket || !activeConversation) return;

    socket.emit('typing', { 
      conversationId: activeConversation._id, 
      isTyping: true 
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { 
        conversationId: activeConversation._id, 
        isTyping: false 
      });
    }, 1000);
  };

  const startDM = async (userId) => {
    try {
      const res = await axios.post(`${API_URL}/conversations/dm/${userId}`);
      const conv = res.data.conversation;
      
      setConversations(prev => {
        const exists = prev.find(c => c._id === conv._id);
        if (exists) return prev;
        return [conv, ...prev];
      });
      
      setActiveConversation(conv);
      setShowNewChat(false);
    } catch (error) {
      console.error('Failed to start DM:', error);
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (!groupName.trim() || selectedUsers.length === 0) return;

    try {
      const res = await axios.post(`${API_URL}/conversations/group`, {
        name: groupName.trim(),
        participants: selectedUsers
      });
      
      setConversations(prev => [res.data.conversation, ...prev]);
      setActiveConversation(res.data.conversation);
      setShowNewGroup(false);
      setGroupName('');
      setSelectedUsers([]);
    } catch (error) {
      console.error('Failed to create group:', error);
    }
  };

  const getConversationName = (conv) => {
    if (conv.isGroup) return conv.name;
    const other = conv.participants.find(p => p._id !== user.id);
    return other?.username || 'Unknown';
  };

  const getConversationStatus = (conv) => {
    if (conv.isGroup) return `${conv.participants.length} members`;
    const other = conv.participants.find(p => p._id !== user.id);
    return other?.isOnline ? 'online' : 'offline';
  };

  const getReadStatus = (msg) => {
    if (msg.sender._id !== user.id) return null;
    
    const readBy = msg.readBy || [];
    const othersWhoRead = readBy.filter(r => {
      const readerId = typeof r === 'string' ? r : r._id;
      return readerId !== user.id;
    });

    if (othersWhoRead.length === 0) return 'sent';
    
    // In DMs, if anyone else read it, it's "read"
    // In groups, show count or "read by all" if everyone read it
    if (!activeConversation?.isGroup) {
      return 'read';
    }
    
    const totalOthers = activeConversation.participants.length - 1;
    if (othersWhoRead.length >= totalOthers) {
      return 'read';
    }
    return `read by ${othersWhoRead.length}`;
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  if (loading) {
    return <div className="chat-loading">Loading...</div>;
  }

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <aside className="chat-sidebar">
        <div className="sidebar-header">
          <h2>Messages</h2>
          <div className="sidebar-actions">
            <button onClick={() => setShowNewChat(true)} title="New message">
              +
            </button>
          </div>
        </div>

        <div className="conversation-list">
          {conversations.length === 0 ? (
            <p className="no-conversations">No conversations yet</p>
          ) : (
            conversations.map(conv => (
              <div
                key={conv._id}
                className={`conversation-item ${activeConversation?._id === conv._id ? 'active' : ''} ${unreadCounts[conv._id] ? 'has-unread' : ''}`}
                onClick={() => setActiveConversation(conv)}
              >
                <div className="conv-avatar">
                  {conv.isGroup ? '#' : getConversationName(conv)[0].toUpperCase()}
                </div>
                <div className="conv-info">
                  <span className="conv-name">{getConversationName(conv)}</span>
                  <span className="conv-preview">
                    {conv.lastMessage?.fileType 
                      ? `${getFileIcon(conv.lastMessage.fileType)} ${conv.lastMessage.fileName || conv.lastMessage.fileType}`
                      : conv.lastMessage?.content || 'No messages yet'}
                  </span>
                </div>
                <div className="conv-meta">
                  {unreadCounts[conv._id] > 0 && (
                    <span className="unread-badge">{unreadCounts[conv._id]}</span>
                  )}
                  {!conv.isGroup && (
                    <span className={`status-dot ${getConversationStatus(conv)}`} />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Chat Area */}
      <main className="chat-main">
        {activeConversation ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                <h3>{getConversationName(activeConversation)}</h3>
                <span className="chat-status">{getConversationStatus(activeConversation)}</span>
              </div>
            </div>

            <div className="messages-area">
              {messages.map((msg, idx) => {
                const readStatus = getReadStatus(msg);
                return (
                  <div
                    key={msg._id || idx}
                    className={`message ${msg.sender._id === user.id ? 'own' : 'other'}`}
                  >
                    {msg.sender._id !== user.id && (
                      <span className="message-sender">{msg.sender.username}</span>
                    )}
                    
                    {/* File attachment */}
                    {msg.fileUrl && (
                      <div className="message-file">
                        {msg.fileType === 'image' ? (
                          <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                            <img src={msg.fileUrl} alt={msg.fileName} className="file-image" />
                          </a>
                        ) : msg.fileType === 'video' ? (
                          <video controls className="file-video">
                            <source src={msg.fileUrl} />
                            Your browser does not support video playback.
                          </video>
                        ) : msg.fileType === 'audio' ? (
                          <audio controls className="file-audio">
                            <source src={msg.fileUrl} />
                            Your browser does not support audio playback.
                          </audio>
                        ) : (
                          <a 
                            href={msg.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="file-document"
                          >
                            <span className="file-icon">📄</span>
                            <div className="file-info">
                              <span className="file-name">{msg.fileName}</span>
                              {msg.fileSize && (
                                <span className="file-size">{formatFileSize(msg.fileSize)}</span>
                              )}
                            </div>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Text content */}
                    {msg.content && <p className="message-content">{msg.content}</p>}
                    
                    <div className="message-meta">
                      <span className="message-time">{formatTime(msg.createdAt)}</span>
                      {readStatus && (
                        <span className={`read-receipt ${readStatus === 'read' ? 'read' : ''}`}>
                          {readStatus === 'sent' ? '✓' : readStatus === 'read' ? '✓✓' : readStatus}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
              
              {Object.keys(typingUsers).length > 0 && (
                <div className="typing-indicator">
                  <span className="typing-dots">
                    <span></span><span></span><span></span>
                  </span>
                  {Object.values(typingUsers).join(', ')} typing...
                </div>
              )}
            </div>

            {/* File Preview */}
            {selectedFile && (
              <div className="file-preview">
                <div className="preview-content">
                  <span className="preview-icon">{getFileIcon(selectedFile.type.split('/')[0])}</span>
                  <div className="preview-info">
                    <span className="preview-name">{selectedFile.name}</span>
                    <span className="preview-size">{formatFileSize(selectedFile.size)}</span>
                  </div>
                </div>
                <button 
                  type="button" 
                  className="preview-remove" 
                  onClick={cancelFileSelection}
                  disabled={uploading}
                >
                  ×
                </button>
              </div>
            )}

            <form className="message-form" onSubmit={selectedFile ? (e) => { e.preventDefault(); handleFileUpload(); } : handleSendMessage}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              />
              <button 
                type="button" 
                className="attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Attach file"
              >
                📎
              </button>
              <input
                type="text"
                value={newMessage}
                onChange={handleTyping}
                placeholder={selectedFile ? "Add a caption (optional)..." : "Type a message..."}
                disabled={uploading}
              />
              <button 
                type="submit" 
                disabled={uploading || (!newMessage.trim() && !selectedFile)}
              >
                {uploading ? '...' : 'Send'}
              </button>
            </form>
          </>
        ) : (
          <div className="no-chat-selected">
            <p>Select a conversation or start a new one</p>
          </div>
        )}
      </main>

      {/* New Chat Modal */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New conversation</h3>
              <button onClick={() => setShowNewChat(false)}>×</button>
            </div>
            <div className="modal-body">
              <button 
                className="create-group-btn"
                onClick={() => { setShowNewChat(false); setShowNewGroup(true); }}
              >
                Create group
              </button>
              <div className="users-list">
                <p className="users-label">Direct messages</p>
                {users.map(u => (
                  <div key={u._id} className="user-item" onClick={() => startDM(u._id)}>
                    <div className="user-avatar">{u.username[0].toUpperCase()}</div>
                    <span className="user-name">{u.username}</span>
                    <span className={`status-dot ${u.isOnline ? 'online' : 'offline'}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Group Modal */}
      {showNewGroup && (
        <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create group</h3>
              <button onClick={() => setShowNewGroup(false)}>×</button>
            </div>
            <form className="modal-body" onSubmit={createGroup}>
              <input
                type="text"
                placeholder="Group name"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                className="group-name-input"
              />
              <p className="users-label">Add members</p>
              <div className="users-list">
                {users.map(u => (
                  <div 
                    key={u._id} 
                    className={`user-item selectable ${selectedUsers.includes(u._id) ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedUsers(prev => 
                        prev.includes(u._id) 
                          ? prev.filter(id => id !== u._id)
                          : [...prev, u._id]
                      );
                    }}
                  >
                    <div className="user-avatar">{u.username[0].toUpperCase()}</div>
                    <span className="user-name">{u.username}</span>
                    {selectedUsers.includes(u._id) && <span className="check">✓</span>}
                  </div>
                ))}
              </div>
              <button 
                type="submit" 
                className="create-btn"
                disabled={!groupName.trim() || selectedUsers.length === 0}
              >
                Create
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
