class PopupManager {
  constructor() {
    this.currentLanguage = 'en';
    this.translations = {};
    this.notifications = [];
    this.renderQueue = [];
    this.isRendering = false;
    this.virtualScrollConfig = {
      itemHeight: 80, // Approximate height of each notification item
      bufferSize: 5,  // Number of items to render outside visible area
      visibleItems: 10 // Number of items visible at once
    };
    this.init();
  }

  async init() {
    await this.loadLanguage();
    this.setupEventListeners();
    this.loadNotifications();
  }

  async loadLanguage() {
    try {
      const result = await chrome.storage.sync.get(['language']);
      this.currentLanguage = result.language || 'en';
      
      const response = await fetch(`_locales/${this.currentLanguage}/messages.json`);
      this.translations = await response.json();
      
      this.updateUI();
    } catch (error) {
      console.error('Failed to load language:', error);
      // Fallback to English if loading fails
      if (this.currentLanguage !== 'en') {
        this.currentLanguage = 'en';
        await this.loadLanguage();
      }
    }
  }

  translate(key, substitutions = []) {
    const translation = this.translations[key];
    if (!translation) return key;
    
    let message = translation.message;
    if (substitutions.length > 0) {
      substitutions.forEach((sub, index) => {
        message = message.replace(`$${index + 1}`, sub);
      });
    }
    
    return message;
  }

  updateUI() {
    // Update all translatable elements
    const elements = {
      'headerTitle': 'popupTitle',
      'loadingText': 'loadingText',
      'emptyText': 'noNotifications',
      'errorText': 'loadError'
    };

    Object.entries(elements).forEach(([elementId, translationKey]) => {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = this.translate(translationKey);
      }
    });

    // Update button titles
    const markAllBtn = document.getElementById('markAllReadBtn');
    if (markAllBtn) {
      markAllBtn.title = this.translate('markAllRead');
    }

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.title = this.translate('settings');
    }

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.title = this.translate('refreshNotifications');
    }

    const clearAllBtn = document.getElementById('clearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.title = this.translate('clearAllNotifications');
    }

    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.textContent = this.translate('retry');
    }
  }

  getNotificationTemplate() {
    // Cache template for better performance
    if (!this._notificationTemplate) {
      this._notificationTemplate = document.createElement('div');
      this._notificationTemplate.innerHTML = `
        <div class="notification-content">
          <div class="notification-title"></div>
          <div class="notification-meta"></div>
        </div>
        <div class="notification-actions"></div>
      `;
    }
    return this._notificationTemplate;
  }

  // Throttled render function for better performance
  throttledRender() {
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    this.renderTimeout = setTimeout(() => {
      this.renderNotifications();
    }, 16); // ~60fps
  }

  setupEventListeners() {
    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Mark all as read button
    document.getElementById('markAllReadBtn').addEventListener('click', () => {
      this.markAllAsRead();
    });

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.refreshNotifications();
    });

    // Clear all button
    document.getElementById('clearAllBtn').addEventListener('click', () => {
      this.clearAllNotifications();
    });

    // Retry button
    document.getElementById('retryBtn').addEventListener('click', () => {
      this.loadNotifications();
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.language) {
        this.loadLanguage();
      }
    });
  }

  async loadNotifications() {
    this.showLoading();
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'refreshNotifications' });
      
      if (response.success) {
        // Show all unread notifications (including updated ones)
        this.notifications = response.notifications.filter(notification => !notification.read);
        this.throttledRender();
      } else {
        this.showError(response.error);
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
      this.showError(error.message);
    }
  }

  showLoading() {
    document.getElementById('loadingIndicator').style.display = 'flex';
    document.getElementById('notificationsList').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
  }

  showError(message) {
    document.getElementById('loadingIndicator').style.display = 'none';
    document.getElementById('notificationsList').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    
    const errorText = document.getElementById('errorText');
    errorText.textContent = message || this.translate('loadError');
  }

  renderNotifications() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const notificationsList = document.getElementById('notificationsList');
    const emptyState = document.getElementById('emptyState');
    const errorState = document.getElementById('errorState');

    loadingIndicator.style.display = 'none';
    errorState.style.display = 'none';

    if (this.notifications.length === 0) {
      notificationsList.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    notificationsList.style.display = 'block';
    
    // Use virtual scrolling for large notification lists
    if (this.notifications.length > 20) {
      this.renderVirtualScrollNotifications(notificationsList);
    } else {
      this.renderAllNotifications(notificationsList);
    }

    // Update mark all read button visibility
    const hasUnread = this.notifications.some(n => !n.read);
    const markAllBtn = document.getElementById('markAllReadBtn');
    markAllBtn.style.display = hasUnread ? 'flex' : 'none';
  }

  renderAllNotifications(container) {
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    this.notifications.forEach(notification => {
      const notificationElement = this.createNotificationElement(notification);
      fragment.appendChild(notificationElement);
    });
    
    // Clear and append all at once
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  renderVirtualScrollNotifications(container) {
    // Implement virtual scrolling for large lists
    container.innerHTML = '';
    container.style.height = '400px';
    container.style.overflowY = 'auto';
    
    const virtualContainer = document.createElement('div');
    virtualContainer.style.height = `${this.notifications.length * this.virtualScrollConfig.itemHeight}px`;
    virtualContainer.style.position = 'relative';
    
    const viewportContainer = document.createElement('div');
    viewportContainer.style.position = 'absolute';
    viewportContainer.style.top = '0';
    viewportContainer.style.left = '0';
    viewportContainer.style.right = '0';
    
    virtualContainer.appendChild(viewportContainer);
    container.appendChild(virtualContainer);
    
    // Initial render
    this.updateVirtualScrollView(container, viewportContainer, 0);
    
    // Add scroll listener with throttling
    let scrollTimeout;
    container.addEventListener('scroll', () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollTop = container.scrollTop;
        this.updateVirtualScrollView(container, viewportContainer, scrollTop);
      }, 16); // ~60fps
    });
  }

  updateVirtualScrollView(container, viewportContainer, scrollTop) {
    const { itemHeight, bufferSize } = this.virtualScrollConfig;
    const containerHeight = container.clientHeight;
    
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
    const endIndex = Math.min(
      this.notifications.length - 1,
      Math.floor((scrollTop + containerHeight) / itemHeight) + bufferSize
    );
    
    // Use DocumentFragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    
    for (let i = startIndex; i <= endIndex; i++) {
      const notification = this.notifications[i];
      const element = this.createNotificationElement(notification);
      element.style.position = 'absolute';
      element.style.top = `${i * itemHeight}px`;
      element.style.left = '0';
      element.style.right = '0';
      element.style.height = `${itemHeight}px`;
      fragment.appendChild(element);
    }
    
    // Clear and update viewport
    viewportContainer.innerHTML = '';
    viewportContainer.appendChild(fragment);
  }

  createNotificationElement(notification) {
    // Use template cloning for better performance
    let template = this.getNotificationTemplate();
    const element = template.cloneNode(true);
    
    element.className = `notification-item ${notification.read ? 'read' : ''} ${notification.isUpdated ? 'updated' : ''}`;
    element.dataset.notificationId = this.sanitizeAttribute(notification.id);

    const formattedDate = this.formatDate(notification.updatedOn);
    
    // Get template elements
    const contentDiv = element.querySelector('.notification-content');
    const titleDiv = element.querySelector('.notification-title');
    const metaDiv = element.querySelector('.notification-meta');
    const actionsDiv = element.querySelector('.notification-actions');
    
    // Clear and rebuild title
    titleDiv.innerHTML = '';
    
    // Add update indicator if needed
    if (notification.isUpdated) {
      const updateIndicator = document.createElement('span');
      updateIndicator.className = 'update-indicator';
      updateIndicator.textContent = '🔄';
      titleDiv.appendChild(updateIndicator);
      titleDiv.appendChild(document.createTextNode(' '));
    }
    
    // Add source badge
    if (notification.sourceType === 'assigned') {
      const badge = document.createElement('span');
      badge.className = 'source-badge assigned';
      badge.title = this.translate('assignedToMe');
      badge.textContent = '📋';
      titleDiv.appendChild(badge);
    } else if (notification.sourceType === 'watched') {
      const badge = document.createElement('span');
      badge.className = 'source-badge watched';
      badge.title = this.translate('watchedByMe');
      badge.textContent = '👁️';
      titleDiv.appendChild(badge);
    }
    
    // Add title text (safely escaped)
    const titleText = document.createTextNode(notification.title || '');
    titleDiv.appendChild(titleText);
    
    // Update meta information
    metaDiv.innerHTML = '';
    const projectSpan = document.createElement('span');
    projectSpan.textContent = notification.project || '';
    metaDiv.appendChild(projectSpan);
    
    const statusSpan = document.createElement('span');
    statusSpan.textContent = notification.status || '';
    metaDiv.appendChild(statusSpan);
    
    const dateSpan = document.createElement('span');
    dateSpan.textContent = formattedDate;
    metaDiv.appendChild(dateSpan);
    
    if (notification.isUpdated) {
      const updateText = document.createElement('span');
      updateText.className = 'update-text';
      updateText.textContent = this.translate('updated');
      metaDiv.appendChild(updateText);
    }
    
    // Update actions
    actionsDiv.innerHTML = '';
    
    if (!notification.read) {
      const markReadBtn = document.createElement('button');
      markReadBtn.className = 'mark-read-btn';
      markReadBtn.title = this.translate('markAsRead');
      markReadBtn.dataset.notificationId = this.sanitizeAttribute(notification.id);
      
      const buttonIcon = document.createElement('span');
      buttonIcon.textContent = '✓';
      markReadBtn.appendChild(buttonIcon);
      
      // Add click handler for mark as read button
      markReadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.markAsRead(notification.id);
      });
      
      actionsDiv.appendChild(markReadBtn);
    }

    // Add click handler for the main notification area
    contentDiv.addEventListener('click', () => {
      this.openNotification(notification);
    });

    return element;
  }

  formatDate(date) {
    const now = new Date();
    const notificationDate = new Date(date);
    const diffInMinutes = Math.floor((now - notificationDate) / (1000 * 60));
    
    if (diffInMinutes < 1) {
      return this.translate('justNow');
    } else if (diffInMinutes < 60) {
      return this.translate('minutesAgo', [diffInMinutes]);
    } else if (diffInMinutes < 1440) {
      const hours = Math.floor(diffInMinutes / 60);
      return this.translate('hoursAgo', [hours]);
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      return this.translate('daysAgo', [days]);
    }
  }

  escapeHtml(text) {
    if (typeof text !== 'string') {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  sanitizeAttribute(value) {
    if (typeof value !== 'string') {
      return String(value || '');
    }
    // Remove any characters that could be dangerous in attributes
    return value.replace(/[<>"'&]/g, '');
  }

  sanitizeUrl(url) {
    if (typeof url !== 'string') {
      return '#';
    }
    try {
      const urlObj = new URL(url);
      // Only allow http and https protocols
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        return url;
      }
    } catch (e) {
      console.warn('Invalid URL provided:', url);
    }
    return '#';
  }

  async openNotification(notification) {
    // Sanitize and validate the URL before opening
    const safeUrl = this.sanitizeUrl(notification.url);
    if (safeUrl === '#') {
      console.error('Invalid or unsafe URL detected:', notification.url);
      return;
    }
    
    try {
      // Open the issue URL in a new tab
      await chrome.tabs.create({ url: safeUrl });
      
      // Close the popup
      window.close();
    } catch (error) {
      console.error('Failed to open notification URL:', error);
    }
  }

  async markAsRead(notificationId) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'markAsRead',
        notificationId: notificationId
      });
      
      if (response.success) {
        // Remove the notification from the array instead of just marking it as read
        this.notifications = this.notifications.filter(n => n.id !== notificationId);
        
        // Re-render the notifications
        this.renderNotifications();
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  async markAllAsRead() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'markAllAsRead' });
      
      if (response.success) {
        // Clear all notifications after marking as read
        this.notifications = [];
        
        // Re-render the notifications (will show empty state)
        this.renderNotifications();
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  }

  async refreshNotifications() {
    // Add visual feedback for refresh
    const refreshBtn = document.getElementById('refreshBtn');
    const originalTransform = refreshBtn.style.transform;
    refreshBtn.style.transform = 'rotate(360deg)';
    refreshBtn.style.transition = 'transform 0.3s ease-in-out';
    refreshBtn.disabled = true;
    
    // Show loading state
    this.showLoading();
    
    // Reset transform after animation
    setTimeout(() => {
      refreshBtn.style.transform = originalTransform;
      refreshBtn.disabled = false;
    }, 300);

    // Force refresh notifications
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'forceRefreshNotifications' 
      });
      
      if (response.success) {
        // Show all unread notifications (including updated ones)
        this.notifications = response.notifications.filter(notification => !notification.read);
        this.renderNotifications();
      } else {
        // If force refresh fails, try regular refresh
        this.loadNotifications();
      }
    } catch (error) {
      console.error('Failed to refresh notifications:', error);
      // Fallback to regular load
      this.loadNotifications();
    }
  }

  async clearAllNotifications() {
    // Show confirmation dialog
    const confirmed = confirm(this.translate('clearAllConfirmation'));
    if (!confirmed) return;
    
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'clearAllNotifications' 
      });
      
      if (response.success) {
        this.notifications = [];
        this.renderNotifications();
      } else {
        alert(this.translate('clearAllError'));
      }
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
      alert(this.translate('clearAllError'));
    }
  }
}

// Initialize the popup when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
