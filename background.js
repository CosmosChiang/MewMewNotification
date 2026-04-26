if (typeof importScripts === 'function') {
  importScripts('scripts/shared/config-manager.js');
}

class RedmineAPI {
  constructor(baseUrl, apiKey) {
    // Validate inputs
    this.baseUrl = this.validateBaseUrl(baseUrl);
    this.apiKey = this.sanitizeApiKey(apiKey);
    this.currentUser = null;
    this.requestQueue = [];
    this.isProcessing = false;
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // 1 second between requests to prevent rate limiting
    
    // Performance optimization: cache management
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.defaultCacheTime = 5 * 60 * 1000; // 5 minutes default cache
    this.lastSyncTime = null;
    this.incrementalSyncEnabled = true;
  }

  async request(endpoint, options = {}) {
    // Check cache first for GET requests
    if (!options.method || options.method === 'GET') {
      const cacheKey = `${endpoint}_${JSON.stringify(options)}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log(`Cache hit for: ${endpoint}`);
        return cached;
      }
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({ endpoint, options, resolve, reject });
      this.processQueue();
    });
  }

  getFromCache(key) {
    const expiry = this.cacheExpiry.get(key);
    if (expiry && Date.now() < expiry) {
      return this.cache.get(key);
    }
    // Clean expired cache
    this.cache.delete(key);
    this.cacheExpiry.delete(key);
    return null;
  }

  setCache(key, value, ttl = this.defaultCacheTime) {
    this.cache.set(key, value);
    this.cacheExpiry.set(key, Date.now() + ttl);
  }

  clearCache() {
    this.cache.clear();
    this.cacheExpiry.clear();
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
        
        // Cache successful GET requests
        if (!options.method || options.method === 'GET') {
          const cacheKey = `${endpoint}_${JSON.stringify(options)}`;
          this.setCache(cacheKey, result);
        }
        
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
        // Get response body for better error diagnosis
        let errorDetails = '';
        let errorBody = '';
        try {
          errorBody = await response.text();
          if (errorBody) {
            errorDetails = ` - ${errorBody}`;
          }
        } catch (e) {
          // Ignore error reading response body
        }
        
        // Handle specific HTTP status codes
        if (response.status === 422) {
          console.error('Redmine API returned 422 - Unprocessable Content. This usually means invalid parameters.');
          console.error('Request URL:', response.url);
          console.error('Response body:', errorBody);
          
          // Try to extract specific error information from response
          let specificError = 'Invalid API parameters';
          if (errorBody) {
            try {
              const errorJson = JSON.parse(errorBody);
              if (errorJson.errors) {
                specificError = Array.isArray(errorJson.errors) 
                  ? errorJson.errors.join(', ') 
                  : JSON.stringify(errorJson.errors);
              }
            } catch (e) {
              // If not JSON, use the raw error body
              specificError = errorBody.substring(0, 200); // Limit length
            }
          }
          
          throw new Error(`Invalid API parameters (HTTP 422): ${specificError}`);
        } else if (response.status === 401) {
          throw new Error('Authentication failed - please check your API key');
        } else if (response.status === 403) {
          throw new Error('Access forbidden - insufficient permissions');
        } else if (response.status === 404) {
          throw new Error('Resource not found - please check your Redmine URL');
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorDetails}`);
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
      try {
        const response = await this.request('/users/current.json');
        this.currentUser = response.user;
        console.log('Current user loaded:', { id: this.currentUser.id });
        
        // Try to detect Redmine version from response headers or other means
        // This helps us adapt API parameters for different Redmine versions
        if (response.redmine_version) {
          this.redmineVersion = response.redmine_version;
          console.log('Detected Redmine version:', this.redmineVersion);
        }
      } catch (error) {
        console.error('Failed to get current user:', error);
        throw error;
      }
    }
    return this.currentUser;
  }

  async getIssues(limit = 50, onlyMyProjects = true, includeWatchedIssues = false, useIncrementalSync = true) {
    const currentUser = await this.getCurrentUser();
    const allIssues = [];
    const seenIssueIds = new Set();

    // Base parameters for all requests - use only safe, well-supported parameters
    const baseParams = {
      status_id: 'open',
      sort: 'updated_on:desc',
      limit: Math.min(Math.max(1, parseInt(limit) || 50), 100) // Ensure reasonable limit
    };

    // Smart incremental sync: only enable if we have successful previous sync data
    if (useIncrementalSync && this.lastSyncTime) {
      console.log('Incremental sync enabled with last sync time:', this.lastSyncTime);
    } else {
      console.log('Full sync mode: no previous sync data or incremental sync disabled');
      useIncrementalSync = false;
    }

    console.log('API request parameters (base):', baseParams);

    try {
      // Get assigned issues if onlyMyProjects is true
      if (onlyMyProjects) {
        // Use only the most basic, well-supported parameters
        const assignedParams = {
          status_id: 'open',
          assigned_to_id: parseInt(currentUser.id), // Ensure it's a number
          sort: 'updated_on:desc',
          limit: baseParams.limit
        };
        
        console.log('Assigned issues request params:', assignedParams);
        
        // Convert to URLSearchParams with validation
        const urlParams = new URLSearchParams();
        Object.entries(assignedParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            urlParams.append(key, String(value));
          }
        });
        
        console.log(`Fetching issues assigned to user: [USER_ID: ${currentUser.id}]`);
        console.log('Final URL params:', urlParams.toString());
        
        const assignedResponse = await this.request(`/issues.json?${urlParams.toString()}`);
        
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
    } catch (error) {
      console.error('Error fetching assigned issues:', error);
      
      // If this is a 422 error, try with even simpler parameters
      if (error.message.includes('422') && onlyMyProjects) {
        console.warn('Trying simplified assigned issues request...');
        try {
          // Most basic request possible
          const simpleParams = new URLSearchParams({
            assigned_to_id: String(currentUser.id),
            status_id: 'open'
          });
          
          console.log('Simplified request params:', simpleParams.toString());
          const fallbackResponse = await this.request(`/issues.json?${simpleParams.toString()}`);
          
          if (fallbackResponse.issues) {
            fallbackResponse.issues.forEach(issue => {
              if (!seenIssueIds.has(issue.id)) {
                issue.sourceType = 'assigned';
                allIssues.push(issue);
                seenIssueIds.add(issue.id);
              }
            });
          }
          console.log('Simplified request succeeded');
        } catch (fallbackError) {
          console.error('Even simplified request failed:', fallbackError);
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }

    // Get watched issues if includeWatchedIssues is true
    if (includeWatchedIssues) {
      try {
        // Use basic parameters for watched issues
        const watchedParams = {
          status_id: 'open',
          watcher_id: parseInt(currentUser.id),
          sort: 'updated_on:desc',
          limit: baseParams.limit
        };
        
        console.log('Watched issues request params:', watchedParams);
        
        const urlParams = new URLSearchParams();
        Object.entries(watchedParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            urlParams.append(key, String(value));
          }
        });
        
        console.log(`Fetching issues watched by user: [USER_ID: ${currentUser.id}]`);
        console.log('Watched URL params:', urlParams.toString());
        
        const watchedResponse = await this.request(`/issues.json?${urlParams.toString()}`);
        
        if (watchedResponse.issues) {
          watchedResponse.issues.forEach(issue => {
            if (!seenIssueIds.has(issue.id)) {
              issue.sourceType = 'watched'; // Mark the source
              allIssues.push(issue);
              seenIssueIds.add(issue.id);
            }
          });
        }
      } catch (error) {
        // Log warning but don't fail the entire operation for watched issues
        console.warn('Failed to fetch watched issues (this is often expected if not supported):', error.message);
        
        // Some Redmine instances don't support watcher_id parameter
        if (error.message.includes('422')) {
          console.log('Watched issues may not be supported by this Redmine instance');
        }
      }
    }

    // If neither filter is applied, get all open issues
    if (!onlyMyProjects && !includeWatchedIssues) {
      try {
        // Use very basic parameters for all issues
        const allParams = new URLSearchParams({
          status_id: 'open',
          sort: 'updated_on:desc',
          limit: String(baseParams.limit)
        });
        
        console.log('All issues request params:', allParams.toString());
        console.log('Fetching all open issues');
        
        const allResponse = await this.request(`/issues.json?${allParams.toString()}`);
        
        if (allResponse.issues) {
          allResponse.issues.forEach(issue => {
            issue.sourceType = 'all';
            allIssues.push(issue);
          });
        }
      } catch (error) {
        console.error('Error fetching all issues:', error);
        throw error;
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
    const configManagerClass = globalThis.ConfigManager;
    const validation = configManagerClass?.validateRedmineUrl
      ? configManagerClass.validateRedmineUrl(url)
      : { valid: false, messageKey: 'invalidUrlFormat' };

    if (!validation.valid) {
      throw new Error(validation.messageKey || 'invalidUrlFormat');
    }

    return validation.normalizedUrl;
  }

  // Helper method to validate API parameters
  validateApiParams(params) {
    const validatedParams = {};
    
    for (const [key, value] of Object.entries(params)) {
      // Skip undefined or null values
      if (value === undefined || value === null) {
        continue;
      }
      
      // Validate specific parameter formats
      switch (key) {
        case 'updated_on':
          // Ensure date format is valid
          if (typeof value === 'string' && value.match(/^>=\d{4}-\d{2}-\d{2}/)) {
            validatedParams[key] = value;
          } else {
            console.warn(`Invalid updated_on format: ${value}, skipping`);
          }
          break;
          
        case 'assigned_to_id':
        case 'watcher_id':
          // Ensure IDs are numeric
          const numericId = parseInt(value);
          if (!isNaN(numericId) && numericId > 0) {
            validatedParams[key] = numericId;
          } else {
            console.warn(`Invalid ${key}: ${value}, skipping`);
          }
          break;
          
        case 'status_id':
          // Allow 'open' or numeric values
          if (value === 'open' || (!isNaN(parseInt(value)) && parseInt(value) > 0)) {
            validatedParams[key] = value;
          } else {
            console.warn(`Invalid status_id: ${value}, using 'open'`);
            validatedParams[key] = 'open';
          }
          break;
          
        case 'limit':
          // Ensure limit is reasonable
          const limit = parseInt(value);
          if (!isNaN(limit) && limit > 0 && limit <= 1000) {
            validatedParams[key] = limit;
          } else {
            console.warn(`Invalid limit: ${value}, using 50`);
            validatedParams[key] = 50;
          }
          break;
          
        default:
          // For other parameters, just ensure they're not empty
          if (value !== '') {
            validatedParams[key] = value;
          }
      }
    }
    
    return validatedParams;
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
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.migrateLegacyApiKey) {
      await configManagerClass.migrateLegacyApiKey();
    }

    const [syncResult, localResult] = await Promise.all([
      chrome.storage.sync.get([
      'redmineUrl',
      'checkInterval',
      'enableNotifications',
      'enableSound',
      'maxNotifications',
      'readNotifications',
      'onlyMyProjects',
      'includeWatchedIssues'
      ]),
      chrome.storage.local.get(['apiKey'])
    ]);

    const apiKey = localResult.apiKey || '';

    this.settings = {
      redmineUrl: syncResult.redmineUrl || '',
      apiKey: apiKey,
      checkInterval: syncResult.checkInterval || 15,
      enableNotifications: syncResult.enableNotifications !== false,
      enableSound: syncResult.enableSound !== false,
      maxNotifications: syncResult.maxNotifications || 50,
      readNotifications: syncResult.readNotifications || [],
      onlyMyProjects: syncResult.onlyMyProjects !== false,
      includeWatchedIssues: syncResult.includeWatchedIssues !== false
    };
    
    console.log('Settings loaded:', {
      redmineUrl: this.settings.redmineUrl ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
      apiKey: this.settings.apiKey ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
      checkInterval: this.settings.checkInterval,
      enableNotifications: this.settings.enableNotifications,
      enableSound: this.settings.enableSound,
      maxNotifications: this.settings.maxNotifications,
      onlyMyProjects: this.settings.onlyMyProjects,
      includeWatchedIssues: this.settings.includeWatchedIssues
    });
  }

  resolveErrorMessage(message) {
    const translated = this.translate(message);
    if (translated !== message) {
      return translated;
    }

    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.redactSensitiveText) {
      const sanitizedMessage = configManagerClass.redactSensitiveText(message);
      if (sanitizedMessage) {
        return sanitizedMessage;
      }
    }

    return message;
  }

  async ensureConfiguredHostAccess() {
    if (!this.settings?.redmineUrl) {
      return;
    }

    const configManagerClass = globalThis.ConfigManager;
    const validation = configManagerClass?.validateRedmineUrl
      ? configManagerClass.validateRedmineUrl(this.settings.redmineUrl)
      : { valid: true, originPattern: undefined };

    if (!validation.valid) {
      throw new Error(validation.messageKey || 'invalidUrlFormat');
    }

    if (!chrome.permissions?.contains || !validation.originPattern) {
      return;
    }

    const hasPermission = await chrome.permissions.contains({
      origins: [validation.originPattern]
    });

    if (!hasPermission) {
      throw new Error('hostPermissionRequired');
    }
  }

  async checkNotifications() {
    if (!this.settings.redmineUrl || !this.settings.apiKey) {
      console.log('Redmine settings not configured');
      return;
    }

    console.log('Checking notifications...', {
      url: this.settings.redmineUrl ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
      interval: this.settings.checkInterval,
      enabled: this.settings.enableNotifications
    });

    try {
      // Performance monitoring
      const startTime = performance.now();
      await this.ensureConfiguredHostAccess();
      
      const api = new RedmineAPI(this.settings.redmineUrl, this.settings.apiKey);
      
      // Load last sync time from storage
      const syncData = await chrome.storage.local.get(['lastSyncTime']);
      if (syncData.lastSyncTime) {
        api.lastSyncTime = new Date(syncData.lastSyncTime);
      }
      
      const response = await api.getIssues(
        this.settings.maxNotifications, 
        this.settings.onlyMyProjects,
        this.settings.includeWatchedIssues,
        true // Enable incremental sync
      );
      
      // Update last sync time
      const currentSyncTime = new Date();
      api.lastSyncTime = currentSyncTime;
      await chrome.storage.local.set({ lastSyncTime: currentSyncTime.toISOString() });
      
      const apiDuration = performance.now() - startTime;
      if (apiDuration > 5000) {
        console.warn(`Slow API response: ${apiDuration.toFixed(2)}ms`);
      }
      
      console.log('API response:', { 
        issueCount: response.issues?.length || 0, 
        totalCount: response.total_count,
        limit: response.limit,
        incrementalSync: api.lastSyncTime ? 'enabled' : 'disabled',
        duration: `${apiDuration.toFixed(2)}ms`
      });
      console.log('Only my projects filter:', this.settings.onlyMyProjects);
      console.log('Include watched issues:', this.settings.includeWatchedIssues);
      
      const issues = response.issues || [];
      const newNotifications = [];
      const updatedNotifications = [];

      // Get previous issue states for comparison
      const result = await chrome.storage.local.get(['issueStates']);
      const previousIssueStates = result.issueStates || {};

      console.log('Previous issue states count:', Object.keys(previousIssueStates).length);
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
      
      // Handle specific error types
      let errorMessage = this.resolveErrorMessage(error.message);
      let shouldRetry = true;
      
      if (error.message.includes('422')) {
        errorMessage = 'Invalid API parameters - check your Redmine configuration';
        shouldRetry = false; // Don't retry 422 errors immediately
        
        // Clear incremental sync data to force full sync next time
        await chrome.storage.local.remove(['lastSyncTime']);
        console.log('Cleared incremental sync data due to 422 error');
        
      } else if (error.message.includes('401')) {
        errorMessage = 'Authentication failed - please check your API key';
        shouldRetry = false;
        
      } else if (error.message.includes('403')) {
        errorMessage = 'Access forbidden - insufficient permissions';
        shouldRetry = false;
        
      } else if (error.message.includes('404')) {
        errorMessage = 'Resource not found - please check your Redmine URL';
        shouldRetry = false;
        
      } else if (error.message.includes('connectionTimeout')) {
        errorMessage = 'Connection timeout - Redmine server may be slow';
        
      } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Network error - check your internet connection';
      } else if (error.message === 'hostPermissionRequired') {
        errorMessage = this.translate('hostPermissionRequired');
        shouldRetry = false;
      }
      
      // Store error information for debugging
      await chrome.storage.local.set({ 
        lastError: errorMessage,
        lastErrorTime: Date.now(),
        shouldRetry: shouldRetry
      });
      
      // Update badge to show error state
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
      chrome.action.setTitle({ title: `Error: ${errorMessage}` });
      
      console.log(`Error handling completed. Should retry: ${shouldRetry}`);
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
      
      // ...已移除除錯用 log...
      
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
    console.log('Current settings:', {
      redmineUrl: notificationManager.settings.redmineUrl ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
      apiKey: notificationManager.settings.apiKey ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
      checkInterval: notificationManager.settings.checkInterval,
      enableNotifications: notificationManager.settings.enableNotifications,
      enableSound: notificationManager.settings.enableSound,
      maxNotifications: notificationManager.settings.maxNotifications,
      onlyMyProjects: notificationManager.settings.onlyMyProjects,
      includeWatchedIssues: notificationManager.settings.includeWatchedIssues
    });
    
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
    console.log('Storage changes detected:', Object.keys(changes));
    
    // Reload settings if any setting changed
    if (Object.keys(changes).some(key => ['redmineUrl', 'checkInterval', 'enableNotifications', 'enableSound', 'maxNotifications', 'onlyMyProjects', 'includeWatchedIssues', 'readNotifications'].includes(key))) {
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

  if (namespace === 'local' && changes.apiKey) {
    console.log('Local credential change detected, reloading settings...');
    notificationManager.loadSettings();
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
          const safeSettings = {
            ...notificationManager.settings,
            apiKey: notificationManager.settings.apiKey ? '[CONFIGURED]' : '[NOT_CONFIGURED]'
          };
          sendResponse({ 
            success: true, 
            settings: safeSettings,
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
