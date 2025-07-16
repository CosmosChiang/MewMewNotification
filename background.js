class RedmineAPI {
  constructor(baseUrl, apiKey) {
    // Validate inputs
    this.validateBaseUrl(baseUrl);
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = this.sanitizeApiKey(apiKey);
    this.currentUser = null;
    this.requestQueue = [];
    this.isProcessing = false;
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // 1 second between requests to prevent rate limiting
  }

  async request(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ endpoint, options, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const { endpoint, options, resolve, reject } = this.requestQueue.shift();
      
      // Rate limiting: ensure minimum interval between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.minRequestInterval) {
        await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
      }

      try {
        const result = await this.makeRequest(endpoint, options);
        this.lastRequestTime = Date.now();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.isProcessing = false;
  }

  async makeRequest(endpoint, options = {}) {
    // Security validation
    this.validateApiEndpoint(endpoint);
    
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'X-Redmine-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('connectionTimeout')), 30000); // 30 second timeout
    });

    try {
      const fetchPromise = fetch(url, {
        ...options,
        headers
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = response.headers.get('Retry-After') || 60;
        console.warn(`Rate limited. Waiting ${retryAfter} seconds before retry.`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.makeRequest(endpoint, options);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Basic response validation
      if (typeof result !== 'object' || result === null) {
        throw new Error('Invalid response format');
      }

      return result;
    } catch (error) {
      console.error('Redmine API request failed:', error);
      
      // Handle specific error types
      if (error.message === 'connectionTimeout') {
        throw new Error('connectionTimeout');
      }
      
      // Handle network errors with retry logic
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.warn('Network error, will retry on next check cycle');
      }
      
      throw error;
    }
  }

  async getCurrentUser() {
    if (!this.currentUser) {
      const response = await this.request('/users/current.json');
      this.currentUser = response.user;
      console.log('Current user loaded:', this.currentUser);
    }
    return this.currentUser;
  }

  async getIssues(limit = 50, onlyMyProjects = true, includeWatchedIssues = false) {
    const currentUser = await this.getCurrentUser();
    const allIssues = [];
    const seenIssueIds = new Set();

    // Base parameters for all requests
    const baseParams = {
      status_id: 'open',
      sort: 'updated_on:desc',
      limit: limit
    };

    // Get assigned issues if onlyMyProjects is true
    if (onlyMyProjects) {
      const assignedParams = new URLSearchParams({
        ...baseParams,
        assigned_to_id: currentUser.id
      });
      
      console.log(`Fetching issues assigned to user: ${currentUser.name} (ID: ${currentUser.id})`);
      const assignedResponse = await this.request(`/issues.json?${assignedParams}`);
      
      if (assignedResponse.issues) {
        assignedResponse.issues.forEach(issue => {
          if (!seenIssueIds.has(issue.id)) {
            issue.sourceType = 'assigned'; // Mark the source
            allIssues.push(issue);
            seenIssueIds.add(issue.id);
          }
        });
      }
    }

    // Get watched issues if includeWatchedIssues is true
    if (includeWatchedIssues) {
      const watchedParams = new URLSearchParams({
        ...baseParams,
        watcher_id: currentUser.id
      });
      
      console.log(`Fetching issues watched by user: ${currentUser.name} (ID: ${currentUser.id})`);
      const watchedResponse = await this.request(`/issues.json?${watchedParams}`);
      
      if (watchedResponse.issues) {
        watchedResponse.issues.forEach(issue => {
          if (!seenIssueIds.has(issue.id)) {
            issue.sourceType = 'watched'; // Mark the source
            allIssues.push(issue);
            seenIssueIds.add(issue.id);
          }
        });
      }
    }

    // If neither filter is applied, get all open issues
    if (!onlyMyProjects && !includeWatchedIssues) {
      const allParams = new URLSearchParams(baseParams);
      console.log('Fetching all open issues');
      const allResponse = await this.request(`/issues.json?${allParams}`);
      
      if (allResponse.issues) {
        allResponse.issues.forEach(issue => {
          issue.sourceType = 'all';
          allIssues.push(issue);
        });
      }
    }

    // Sort by updated_on date (most recent first)
    allIssues.sort((a, b) => new Date(b.updated_on) - new Date(a.updated_on));

    // Limit the results
    const limitedIssues = allIssues.slice(0, limit);

    return { 
      issues: limitedIssues,
      total_count: limitedIssues.length,
      offset: 0,
      limit: limit
    };
  }

  async testConnection() {
    try {
      await this.getCurrentUser(); // This will also test the connection and load user info
      return { success: true };
    } catch (error) {
      let errorMessage = error.message;
      
      // Handle specific error types
      if (error.message === 'connectionTimeout') {
        errorMessage = 'connectionTimeout';
      }
      
      return { success: false, error: errorMessage };
    }
  }

  // Security validation for API requests
  validateApiEndpoint(endpoint) {
    // Only allow specific Redmine API endpoints
    const allowedEndpoints = [
      '/issues.json',
      '/users/current.json',
      '/projects.json',
      '/time_entries.json',
      '/news.json',
      '/versions.json'
    ];
    
    // Check if the endpoint starts with an allowed pattern
    const isAllowed = allowedEndpoints.some(allowed => 
      endpoint.startsWith(allowed) || endpoint === allowed
    );
    
    if (!isAllowed) {
      throw new Error('Unauthorized API endpoint');
    }
    
    return true;
  }

  sanitizeApiKey(apiKey) {
    if (typeof apiKey !== 'string') {
      throw new Error('Invalid API key format');
    }
    
    // Remove any potentially dangerous characters
    return apiKey.replace(/[^\w\-]/g, '');
  }

  validateBaseUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid protocol. Only HTTP/HTTPS allowed.');
      }
      
      // Basic hostname validation
      if (!urlObj.hostname || urlObj.hostname.length < 1) {
        throw new Error('Invalid hostname');
      }
      
      return true;
    } catch (error) {
      throw new Error('Invalid base URL: ' + error.message);
    }
  }
}

class NotificationManager {
  constructor() {
    this.notifications = new Map();
    this.settings = null;
    this.translations = {};
    this.currentLanguage = 'en';
    this.loadSettings();
    this.loadLanguage();
  }

  async loadLanguage() {
    try {
      // Get language preference from settings
      const result = await chrome.storage.sync.get(['language']);
      this.currentLanguage = result.language || 'en';
      
      // Load translations
      const response = await fetch(`_locales/${this.currentLanguage}/messages.json`);
      this.translations = await response.json();
      
      console.log(`Language loaded: ${this.currentLanguage}`);
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
    if (!translation) {
      console.warn(`Translation missing for key: ${key}`);
      return key;
    }
    
    let message = translation.message;
    if (substitutions.length > 0) {
      substitutions.forEach((sub, index) => {
        message = message.replace(`$${index + 1}`, sub);
      });
    }
    
    return message;
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get([
      'redmineUrl',
      'apiKey',
      'checkInterval',
      'enableNotifications',
      'enableSound',
      'maxNotifications',
      'readNotifications',
      'onlyMyProjects',
      'includeWatchedIssues'
    ]);

    // Use API key directly
    const apiKey = result.apiKey || '';

    this.settings = {
      redmineUrl: result.redmineUrl || '',
      apiKey: apiKey,
      checkInterval: result.checkInterval || 15,
      enableNotifications: result.enableNotifications !== false,
      enableSound: result.enableSound !== false,
      maxNotifications: result.maxNotifications || 50,
      readNotifications: result.readNotifications || [],
      onlyMyProjects: result.onlyMyProjects !== false, // Default to true (only my projects)
      includeWatchedIssues: result.includeWatchedIssues === true // Default to false
    };
    
    console.log('Settings loaded:', this.settings);
  }

  async checkNotifications() {
    if (!this.settings.redmineUrl || !this.settings.apiKey) {
      console.log('Redmine settings not configured');
      return;
    }

    console.log('Checking notifications...', {
      url: this.settings.redmineUrl,
      interval: this.settings.checkInterval,
      enabled: this.settings.enableNotifications
    });

    try {
      const api = new RedmineAPI(this.settings.redmineUrl, this.settings.apiKey);
      const response = await api.getIssues(
        this.settings.maxNotifications, 
        this.settings.onlyMyProjects,
        this.settings.includeWatchedIssues
      );
      
      console.log('API response:', response);
      console.log('Only my projects filter:', this.settings.onlyMyProjects);
      console.log('Include watched issues:', this.settings.includeWatchedIssues);
      
      const issues = response.issues || [];
      const newNotifications = [];
      const updatedNotifications = [];

      // Get previous issue states for comparison
      const result = await chrome.storage.local.get(['issueStates']);
      const previousIssueStates = result.issueStates || {};

      console.log('Previous issue states:', previousIssueStates);
      console.log('Current issues count:', issues.length);

      // Clear error state if successful
      await chrome.storage.local.set({ lastError: null, lastErrorTime: null });
      
      // Create a copy of readNotifications to avoid modifying the original during iteration
      const readNotificationsCopy = [...this.settings.readNotifications];
      const updatedReadNotifications = [...this.settings.readNotifications];
      
      for (const issue of issues) {
        const notificationId = `issue_${issue.id}`;
        const isRead = readNotificationsCopy.includes(notificationId);
        const currentUpdateTime = new Date(issue.updated_on).getTime();
        const previousState = previousIssueStates[issue.id];
        
        const notification = {
          id: notificationId,
          issueId: issue.id,
          title: `#${issue.id}: ${issue.subject}`,
          project: issue.project?.name || this.translate('unknownProject'),
          author: issue.author?.name || this.translate('unknownAuthor'),
          status: issue.status?.name || this.translate('unknownStatus'),
          priority: issue.priority?.name || this.translate('normalPriority'),
          updatedOn: new Date(issue.updated_on),
          url: `${this.settings.redmineUrl}/issues/${issue.id}`,
          read: isRead,
          isUpdated: false,
          sourceType: issue.sourceType || 'unknown'
        };

        // Check if this is a new issue or an updated issue
        if (!previousState) {
          // New issue
          console.log(`New issue detected: ${issue.id}`);
          const hasSeenBefore = await this.hasSeenNotification(notificationId);
          if (!isRead && !hasSeenBefore) {
            newNotifications.push(notification);
          }
        } else {
          // Existing issue - check for updates
          const previousUpdateTime = previousState.updatedOn;
          if (currentUpdateTime > previousUpdateTime) {
            // Issue has been updated
            console.log(`Updated issue detected: ${issue.id}`, {
              previous: new Date(previousUpdateTime),
              current: new Date(currentUpdateTime)
            });
            notification.isUpdated = true;
            
            // If the issue was previously read but now updated, show notification again
            if (isRead) {
              // Remove from read notifications to make it appear as unread
              const readIndex = updatedReadNotifications.indexOf(notificationId);
              if (readIndex > -1) {
                updatedReadNotifications.splice(readIndex, 1);
                notification.read = false;
              }
            }
            
            updatedNotifications.push(notification);
          }
        }

        this.notifications.set(notificationId, notification);

        // Update the issue state in storage
        previousIssueStates[issue.id] = {
          updatedOn: currentUpdateTime,
          status: issue.status?.name,
          subject: issue.subject
        };
      }
      
      // Update read notifications in storage only once after processing all issues
      if (updatedReadNotifications.length !== this.settings.readNotifications.length) {
        this.settings.readNotifications = updatedReadNotifications;
        await chrome.storage.sync.set({ readNotifications: updatedReadNotifications });
      }

      // Save updated issue states
      await chrome.storage.local.set({ issueStates: previousIssueStates });

      console.log('New notifications:', newNotifications.length);
      console.log('Updated notifications:', updatedNotifications.length);

      // Show notifications for new issues
      if (newNotifications.length > 0 && this.settings.enableNotifications) {
        console.log('Showing new notifications');
        this.showDesktopNotification(newNotifications, 'new');
      }

      // Show notifications for updated issues
      if (updatedNotifications.length > 0 && this.settings.enableNotifications) {
        console.log('Showing updated notifications');
        this.showDesktopNotification(updatedNotifications, 'updated');
      }

      // Update badge
      const unreadCount = Array.from(this.notifications.values()).filter(n => !n.read).length;
      this.updateBadge(unreadCount);

      // Store seen notifications
      const seenNotifications = Array.from(this.notifications.keys());
      await chrome.storage.local.set({ seenNotifications });

      console.log('Notification check completed. Unread count:', unreadCount);

    } catch (error) {
      console.error('Failed to check notifications:', error);
      
      // Store error information for debugging
      await chrome.storage.local.set({ 
        lastError: error.message,
        lastErrorTime: Date.now()
      });
      
      // Update badge to show error state
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
      chrome.action.setTitle({ title: `Error: ${error.message}` });
    }
  }

  async hasSeenNotification(notificationId) {
    const result = await chrome.storage.local.get(['seenNotifications']);
    const seenNotifications = result.seenNotifications || [];
    return seenNotifications.includes(notificationId);
  }

  showDesktopNotification(notifications, type = 'new') {
    console.log(`Attempting to show ${type} notification for ${notifications.length} items`);
    
    if (notifications.length === 1) {
      const notification = notifications[0];
      const isUpdate = type === 'updated';
      
      const notificationOptions = {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: isUpdate ? this.translate('issueUpdatedTitle') : this.translate('newIssueTitle'),
        message: notification.title,
        contextMessage: `${notification.project}${isUpdate ? ' (' + this.translate('updated') + ')' : ''}`
      };
      
      console.log('Creating notification with options:', notificationOptions);
      
      chrome.notifications.create(notificationOptions, (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to create notification:', chrome.runtime.lastError);
        } else {
          console.log('Notification created successfully:', notificationId);
        }
      });
    } else {
      const isUpdate = type === 'updated';
      const count = notifications.length;
      const notificationOptions = {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: isUpdate ? this.translate('issuesUpdatedTitle') : this.translate('newIssuesTitle'),
        message: this.translate(isUpdate ? 'multipleIssuesUpdatedMessage' : 'multipleNewIssuesMessage', [count]),
        contextMessage: this.translate('clickToViewAll')
      };
      
      console.log('Creating batch notification with options:', notificationOptions);
      
      chrome.notifications.create(notificationOptions, (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to create batch notification:', chrome.runtime.lastError);
        } else {
          console.log('Batch notification created successfully:', notificationId);
        }
      });
    }
  }

  updateBadge(count) {
    const text = count > 0 ? count.toString() : '';
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
  }

  async markAsRead(notificationId) {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.read = true;
      
      const result = await chrome.storage.sync.get(['readNotifications']);
      const readNotifications = result.readNotifications || [];
      
      if (!readNotifications.includes(notificationId)) {
        readNotifications.push(notificationId);
        await chrome.storage.sync.set({ readNotifications });
      }

      // Update badge
      const unreadCount = Array.from(this.notifications.values()).filter(n => !n.read).length;
      this.updateBadge(unreadCount);
    }
  }

  async markAllAsRead() {
    const unreadNotifications = Array.from(this.notifications.values()).filter(n => !n.read);
    const result = await chrome.storage.sync.get(['readNotifications']);
    const readNotifications = result.readNotifications || [];

    for (const notification of unreadNotifications) {
      notification.read = true;
      if (!readNotifications.includes(notification.id)) {
        readNotifications.push(notification.id);
      }
    }

    await chrome.storage.sync.set({ readNotifications });
    this.updateBadge(0);
  }

  async clearAllNotifications() {
    // Clear all notifications from memory
    this.notifications.clear();
    
    // Clear read notifications from storage
    await chrome.storage.sync.set({ readNotifications: [] });
    
    // Clear seen notifications from local storage
    await chrome.storage.local.set({ seenNotifications: [] });
    
    // Clear issue states to reset update tracking
    await chrome.storage.local.set({ issueStates: {} });
    
    // Update badge
    this.updateBadge(0);
    
    // Clear any active desktop notifications
    chrome.notifications.getAll((notifications) => {
      Object.keys(notifications).forEach(notificationId => {
        chrome.notifications.clear(notificationId);
      });
    });
  }

  async forceRefreshNotifications() {
    // Clear seen notifications to force showing notifications again if needed
    await chrome.storage.local.set({ seenNotifications: [] });
    
    // Force check notifications
    await this.checkNotifications();
  }

  getNotifications() {
    return Array.from(this.notifications.values()).sort((a, b) => b.updatedOn - a.updatedOn);
  }
}

// Background script logic
const notificationManager = new NotificationManager();
const ALARM_NAME = 'redmine-notification-check';

function startPeriodicCheck() {
  stopPeriodicCheck();
  
  notificationManager.loadSettings().then(() => {
    const intervalMinutes = notificationManager.settings.checkInterval || 15;
    console.log(`Starting periodic check with interval: ${intervalMinutes} minutes`);
    console.log('Current settings:', notificationManager.settings);
    
    // Create alarm for periodic checks
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 0, // Start immediately
      periodInMinutes: intervalMinutes
    });
    
    console.log(`Alarm created: ${ALARM_NAME} with ${intervalMinutes} minute interval`);
    
    // Check immediately
    console.log('Running initial notification check');
    notificationManager.checkNotifications();
  }).catch(error => {
    console.error('Failed to load settings:', error);
  });
}

function stopPeriodicCheck() {
  chrome.alarms.clear(ALARM_NAME, (wasCleared) => {
    if (wasCleared) {
      console.log(`Alarm ${ALARM_NAME} cleared`);
    }
  });
}

// Extension event listeners
chrome.runtime.onInstalled.addListener(() => {
  console.log('MewMewNotification extension installed');
  startPeriodicCheck();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('MewMewNotification extension started');
  startPeriodicCheck();
});

// Alarm listener for periodic checks
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Alarm triggered: periodic notification check');
    notificationManager.checkNotifications();
  }
});

// Storage change listener to update settings and language
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    console.log('Storage changes detected:', changes);
    
    // Reload settings if any setting changed
    if (Object.keys(changes).some(key => ['redmineUrl', 'apiKey', 'checkInterval', 'enableNotifications', 'enableSound', 'maxNotifications', 'onlyMyProjects', 'includeWatchedIssues'].includes(key))) {
      console.log('Settings changed, reloading...');
      notificationManager.loadSettings().then(() => {
        // Restart periodic check if check interval changed
        if (changes.checkInterval) {
          console.log('Check interval changed, restarting periodic check');
          startPeriodicCheck();
        }
      });
    }
    
    // Reload language if language setting changed
    if (changes.language) {
      console.log('Language changed, reloading translations...');
      notificationManager.loadLanguage();
    }
  }
});

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getNotifications':
      sendResponse({ notifications: notificationManager.getNotifications() });
      break;
      
    case 'markAsRead':
      notificationManager.markAsRead(request.notificationId).then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // Keep the message channel open for async response
      
    case 'markAllAsRead':
      notificationManager.markAllAsRead().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
      
    case 'testConnection':
      if (!request.redmineUrl || !request.apiKey) {
        sendResponse({ success: false, error: notificationManager.translate('missingRequiredSettings') });
        return;
      }
      
      const api = new RedmineAPI(request.redmineUrl, request.apiKey);
      api.testConnection().then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
      
    case 'refreshNotifications':
      notificationManager.checkNotifications().then(() => {
        sendResponse({ success: true, notifications: notificationManager.getNotifications() });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
      
    case 'forceRefreshNotifications':
      notificationManager.forceRefreshNotifications().then(() => {
        sendResponse({ success: true, notifications: notificationManager.getNotifications() });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
      
    case 'clearAllNotifications':
      notificationManager.clearAllNotifications().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
      
    case 'getSettings':
      // Add a debug endpoint to check current settings
      notificationManager.loadSettings().then(() => {
        chrome.alarms.get(ALARM_NAME, (alarm) => {
          sendResponse({ 
            success: true, 
            settings: notificationManager.settings,
            alarmActive: !!alarm,
            alarmInfo: alarm || null
          });
        });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
  }
});

// Notification click handler
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.action.openPopup();
});

// Start the periodic check
startPeriodicCheck();
