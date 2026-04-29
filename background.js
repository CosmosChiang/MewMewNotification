if (typeof importScripts === 'function') {
  importScripts('scripts/shared/config-manager.js');
}

const HOST_PERMISSION_RECOVERY_NOTIFICATION_ID = 'host-permission-recovery';
const NOTIFICATION_HISTORY_STORAGE_KEY = 'notificationHistory';
const MAX_NOTIFICATION_HISTORY_ITEMS = 100;

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

      if (response.status === 204) {
        return {};
      }

      const responseText = await response.text();
      if (!responseText) {
        return {};
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error('Invalid response format');
      }
      
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

  parsePositiveInteger(value, fieldName = 'identifier') {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid ${fieldName}`);
      }
      return value;
    }

    if (typeof value === 'string') {
      const trimmedValue = value.trim();
      if (!/^[0-9]+$/.test(trimmedValue)) {
        throw new Error(`Invalid ${fieldName}`);
      }

      const parsedValue = Number(trimmedValue);
      if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        throw new Error(`Invalid ${fieldName}`);
      }

      return parsedValue;
    }

    throw new Error(`Invalid ${fieldName}`);
  }

  sanitizeIssueNotes(notes) {
    if (typeof notes !== 'string') {
      throw new Error('Reply content is required');
    }

    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      throw new Error('Reply content is required');
    }

    if (trimmedNotes.length > 5000) {
      throw new Error('Reply content is too long');
    }

    return trimmedNotes;
  }

  buildIssueEndpoint(issueId, queryParams) {
    const safeIssueId = this.parsePositiveInteger(issueId, 'issue id');
    const queryString = queryParams instanceof URLSearchParams
      ? queryParams.toString()
      : new URLSearchParams(queryParams || {}).toString();

    return `/issues/${safeIssueId}.json${queryString ? `?${queryString}` : ''}`;
  }

  isPermissionError(error) {
    return typeof error?.message === 'string' && /403|forbidden/i.test(error.message);
  }

  isNotFoundError(error) {
    return typeof error?.message === 'string' && /404|not found/i.test(error.message);
  }

  normalizeStatusOptions(statuses) {
    if (!Array.isArray(statuses)) {
      return [];
    }

    return statuses
      .filter(status => Number.isInteger(status?.id) && typeof status?.name === 'string' && status.name.trim())
      .map(status => ({
        id: status.id,
        name: status.name.trim()
      }));
  }

  normalizeAssigneeOptions(memberships, issue) {
    const assigneeMap = new Map();

    if (Array.isArray(memberships)) {
      memberships.forEach(membership => {
        const user = membership?.user;
        if (Number.isInteger(user?.id) && typeof user?.name === 'string' && user.name.trim()) {
          assigneeMap.set(user.id, {
            id: user.id,
            name: user.name.trim()
          });
        }
      });
    }

    const currentAssignee = issue?.assigned_to;
    if (
      Number.isInteger(currentAssignee?.id)
      && typeof currentAssignee?.name === 'string'
      && currentAssignee.name.trim()
      && !assigneeMap.has(currentAssignee.id)
    ) {
      assigneeMap.set(currentAssignee.id, {
        id: currentAssignee.id,
        name: currentAssignee.name.trim()
      });
    }

    return Array.from(assigneeMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  async getIssueDetails(issueId) {
    const queryParams = new URLSearchParams({
      include: 'allowed_statuses'
    });

    return this.request(this.buildIssueEndpoint(issueId, queryParams));
  }

  async getProjectMemberships(projectId) {
    const safeProjectId = this.parsePositiveInteger(projectId, 'project id');
    const queryParams = new URLSearchParams({
      limit: '100'
    });

    return this.request(`/projects/${safeProjectId}/memberships.json?${queryParams.toString()}`);
  }

  async getIssueStatuses() {
    return this.request('/issue_statuses.json');
  }

  async getIssueActionContext(issueId) {
    const issueResponse = await this.getIssueDetails(issueId);
    const issue = issueResponse.issue;

    if (!issue || !Number.isInteger(issue.id)) {
      throw new Error('Resource not found - please check your Redmine URL');
    }

    let statusOptions = this.normalizeStatusOptions(issue.allowed_statuses);
    if (statusOptions.length === 0) {
      const statusResponse = await this.getIssueStatuses();
      statusOptions = this.normalizeStatusOptions(statusResponse.issue_statuses);
    }

    let assigneeOptions = [];
    if (Number.isInteger(issue.project?.id)) {
      try {
        const membershipsResponse = await this.getProjectMemberships(issue.project.id);
        assigneeOptions = this.normalizeAssigneeOptions(membershipsResponse.memberships, issue);
      } catch (error) {
        if (!this.isPermissionError(error) && !this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return {
      issue,
      permissions: {
        canReply: true,
        canChangeStatus: statusOptions.length > 0,
        canChangeAssignee: assigneeOptions.length > 0
      },
      current: {
        statusId: Number.isInteger(issue.status?.id) ? issue.status.id : undefined,
        assigneeId: Number.isInteger(issue.assigned_to?.id) ? issue.assigned_to.id : undefined
      },
      statusOptions,
      assigneeOptions
    };
  }

  async updateIssue(issueId, issueData) {
    const sanitizedIssueData = Object.fromEntries(
      Object.entries(issueData).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(sanitizedIssueData).length === 0) {
      throw new Error('No issue changes provided');
    }

    return this.request(this.buildIssueEndpoint(issueId), {
      method: 'PUT',
      body: JSON.stringify({
        issue: sanitizedIssueData
      })
    });
  }

  buildIssueUpdateData(changes = {}) {
    if (!changes || typeof changes !== 'object') {
      throw new Error('No issue changes provided');
    }

    const issueData = {};

    if (typeof changes.reply === 'string' && changes.reply.trim()) {
      issueData.notes = this.sanitizeIssueNotes(changes.reply);
    }

    if (changes.statusId !== undefined && changes.statusId !== null && changes.statusId !== '') {
      issueData.status_id = this.parsePositiveInteger(changes.statusId, 'status id');
    }

    if (changes.assigneeId !== undefined && changes.assigneeId !== null && changes.assigneeId !== '') {
      issueData.assigned_to_id = this.parsePositiveInteger(changes.assigneeId, 'assignee id');
    }

    if (Object.keys(issueData).length === 0) {
      throw new Error('No issue changes provided');
    }

    return issueData;
  }

  async applyIssueChanges(issueId, changes) {
    return this.updateIssue(issueId, this.buildIssueUpdateData(changes));
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
    const normalizedEndpoint = typeof endpoint === 'string'
      ? endpoint.split('?')[0]
      : '';
    const allowedEndpointPatterns = [
      /^\/issues\.json$/,
      /^\/issues\/\d+\.json$/,
      /^\/users\/current\.json$/,
      /^\/projects\.json$/,
      /^\/projects\/\d+\/memberships\.json$/,
      /^\/time_entries\.json$/,
      /^\/news\.json$/,
      /^\/versions\.json$/,
      /^\/issue_statuses\.json$/
    ];
    
    // Check if the endpoint starts with an allowed pattern
    const isAllowed = allowedEndpointPatterns.some(allowedPattern =>
      allowedPattern.test(normalizedEndpoint)
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
    this.notificationHistoryStorageKey = NOTIFICATION_HISTORY_STORAGE_KEY;
    this.notificationHistoryLimit = MAX_NOTIFICATION_HISTORY_ITEMS;
    this.settings = this.getDefaultSettings();
    this.settingsLoaded = false;
    this.settingsLoadPromise = undefined;
    this.translations = {};
    this.currentLanguage = 'en';
    this.loadSettings().catch(error => {
      console.error('Failed to preload settings:', error);
    });
    this.loadLanguage();
  }

  getDefaultSettings() {
    return {
      redmineUrl: '',
      apiKey: '',
      checkInterval: 15,
      enableNotifications: true,
      enableSound: true,
      maxNotifications: 50,
      readNotifications: [],
      onlyMyProjects: true,
      includeWatchedIssues: true
    };
  }

  async loadLanguage() {
    try {
      // Get language preference from settings
      const result = await chrome.storage.sync.get(['language']);
      const languageSettings = this.normalizeStorageResult(result);
      this.currentLanguage = languageSettings.language || 'en';
      
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

  getFallbackTranslation(key, fallbackMessage) {
    return this.translations[key]?.message || fallbackMessage;
  }

  normalizeStorageResult(result) {
    const configManagerClass = globalThis.ConfigManager;
    return configManagerClass?.normalizeStorageResult
      ? configManagerClass.normalizeStorageResult(result)
      : (result && typeof result === 'object' ? result : {});
  }

  parseHistoryDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
  }

  normalizeChangeSummary(changeSummary) {
    if (!Array.isArray(changeSummary)) {
      return [];
    }

    return changeSummary
      .filter(item => item && typeof item === 'object' && typeof item.field === 'string')
      .map(item => ({
        field: item.field,
        from: item.from === undefined || item.from === null ? '' : String(item.from),
        to: item.to === undefined || item.to === null ? '' : String(item.to)
      }));
  }

  normalizeIssueSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return undefined;
    }

    return {
      subject: typeof snapshot.subject === 'string' ? snapshot.subject : '',
      status: typeof snapshot.status === 'string' ? snapshot.status : '',
      priority: typeof snapshot.priority === 'string' ? snapshot.priority : '',
      assigneeId: Number.isInteger(snapshot.assigneeId) ? snapshot.assigneeId : undefined,
      assigneeName: typeof snapshot.assigneeName === 'string' ? snapshot.assigneeName : '',
      updatedOn: Number.isFinite(snapshot.updatedOn) ? snapshot.updatedOn : 0
    };
  }

  normalizeNotificationHistoryRecord(record) {
    if (!record || typeof record !== 'object') {
      return undefined;
    }

    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) {
      return undefined;
    }

    const updatedOn = this.parseHistoryDate(record.updatedOn);

    return {
      id,
      issueId: Number.isInteger(record.issueId) ? record.issueId : undefined,
      title: typeof record.title === 'string' ? record.title : '',
      project: typeof record.project === 'string' ? record.project : '',
      author: typeof record.author === 'string' ? record.author : '',
      status: typeof record.status === 'string' ? record.status : '',
      priority: typeof record.priority === 'string' ? record.priority : '',
      assigneeId: Number.isInteger(record.assigneeId) ? record.assigneeId : undefined,
      assigneeName: typeof record.assigneeName === 'string' ? record.assigneeName : '',
      projectId: Number.isInteger(record.projectId) ? record.projectId : undefined,
      updatedOn,
      url: typeof record.url === 'string' ? record.url : '',
      read: record.read === true,
      isUpdated: record.isUpdated === true,
      sourceType: typeof record.sourceType === 'string' ? record.sourceType : 'unknown',
      changeSummary: this.normalizeChangeSummary(record.changeSummary),
      lastSeenState: this.normalizeIssueSnapshot(record.lastSeenState)
    };
  }

  serializeNotificationHistoryRecord(record) {
    const normalizedRecord = this.normalizeNotificationHistoryRecord(record);
    if (!normalizedRecord) {
      return undefined;
    }

    return {
      ...normalizedRecord,
      updatedOn: normalizedRecord.updatedOn.toISOString()
    };
  }

  applyNotificationHistoryRetention(records) {
    return records
      .map(record => this.normalizeNotificationHistoryRecord(record))
      .filter(Boolean)
      .sort((left, right) => right.updatedOn - left.updatedOn)
      .slice(0, this.notificationHistoryLimit);
  }

  async loadNotificationHistory() {
    const result = this.normalizeStorageResult(
      await chrome.storage.local.get([this.notificationHistoryStorageKey])
    );
    const history = Array.isArray(result[this.notificationHistoryStorageKey])
      ? result[this.notificationHistoryStorageKey]
      : [];

    return this.applyNotificationHistoryRetention(history);
  }

  async saveNotificationHistory(history) {
    const retainedHistory = this.applyNotificationHistoryRetention(history);
    const serializedHistory = retainedHistory
      .map(record => this.serializeNotificationHistoryRecord(record))
      .filter(Boolean);

    await chrome.storage.local.set({
      [this.notificationHistoryStorageKey]: serializedHistory
    });

    return retainedHistory;
  }

  async mergeNotificationHistory(notifications, { readNotificationIds = [] } = {}) {
    const existingHistory = await this.loadNotificationHistory();
    const historyById = new Map(existingHistory.map(record => [record.id, record]));
    const readNotificationSet = new Set(Array.isArray(readNotificationIds) ? readNotificationIds : []);

    (Array.isArray(notifications) ? notifications : []).forEach(notification => {
      const normalizedNotification = this.normalizeNotificationHistoryRecord(notification);
      if (!normalizedNotification) {
        return;
      }

      const existingRecord = historyById.get(normalizedNotification.id);
      const reconciledReadState = normalizedNotification.isUpdated
        ? normalizedNotification.read
        : normalizedNotification.read || existingRecord?.read === true || readNotificationSet.has(normalizedNotification.id);

      historyById.set(normalizedNotification.id, {
        ...existingRecord,
        ...normalizedNotification,
        read: reconciledReadState
      });
    });

    return this.saveNotificationHistory(Array.from(historyById.values()));
  }

  async loadSettings({ notifyPermissionRecovery = false } = {}) {
    if (this.settingsLoadPromise) {
      return this.settingsLoadPromise;
    }

    this.settingsLoadPromise = this.loadSettingsInternal({ notifyPermissionRecovery });

    try {
      return await this.settingsLoadPromise;
    } finally {
      this.settingsLoadPromise = undefined;
    }
  }

  async loadSettingsInternal({ notifyPermissionRecovery = false } = {}) {
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

    const syncSettings = this.normalizeStorageResult(syncResult);
    const localSettings = this.normalizeStorageResult(localResult);
    const defaultSettings = this.getDefaultSettings();

    this.settings = {
      ...defaultSettings,
      redmineUrl: typeof syncSettings.redmineUrl === 'string'
        ? syncSettings.redmineUrl
        : defaultSettings.redmineUrl,
      apiKey: typeof localSettings.apiKey === 'string'
        ? localSettings.apiKey
        : defaultSettings.apiKey,
      checkInterval: Number.isFinite(syncSettings.checkInterval) && syncSettings.checkInterval > 0
        ? syncSettings.checkInterval
        : defaultSettings.checkInterval,
      enableNotifications: syncSettings.enableNotifications !== false,
      enableSound: syncSettings.enableSound !== false,
      maxNotifications: Number.isFinite(syncSettings.maxNotifications) && syncSettings.maxNotifications > 0
        ? syncSettings.maxNotifications
        : defaultSettings.maxNotifications,
      readNotifications: Array.isArray(syncSettings.readNotifications)
        ? syncSettings.readNotifications
        : defaultSettings.readNotifications,
      onlyMyProjects: syncSettings.onlyMyProjects !== false,
      includeWatchedIssues: syncSettings.includeWatchedIssues !== false
    };
    this.settingsLoaded = true;

    await this.syncHostPermissionRecoveryState({ notify: notifyPermissionRecovery });
    
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

  async ensureSettingsLoaded() {
    if (this.settingsLoaded) {
      return this.settings;
    }

    await this.loadSettings();
    return this.settings;
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

  getConfiguredHostPermissionState() {
    if (!this.settings?.redmineUrl || !this.settings?.apiKey) {
      return { configured: false };
    }

    const configManagerClass = globalThis.ConfigManager;
    const validation = configManagerClass?.validateRedmineUrl
      ? configManagerClass.validateRedmineUrl(this.settings.redmineUrl)
      : { valid: true, originPattern: undefined };

    if (!validation.valid) {
      return {
        configured: true,
        valid: false,
        errorMessage: validation.messageKey || 'invalidUrlFormat'
      };
    }

    return {
      configured: true,
      valid: true,
      validation,
      permissionRequest: validation.originPattern
        ? { origins: [validation.originPattern] }
        : undefined
    };
  }

  async notifyHostPermissionRecovery(normalizedUrl) {
    if (!chrome.notifications?.create || !chrome.storage?.local) {
      return;
    }

    const result = this.normalizeStorageResult(
      await chrome.storage.local.get(['hostPermissionRecoveryNotifiedFor'])
    );
    if (result.hostPermissionRecoveryNotifiedFor === normalizedUrl) {
      return;
    }

    chrome.notifications.create(
      HOST_PERMISSION_RECOVERY_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: this.getFallbackTranslation('extName', 'MewMewNotification'),
        message: this.getFallbackTranslation(
          'hostPermissionRequired',
          'Grant host access for the configured Redmine server before syncing'
        ),
        contextMessage: normalizedUrl
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to create host permission recovery notification:', chrome.runtime.lastError);
        }
      }
    );

    await chrome.storage.local.set({
      hostPermissionRecoveryNotifiedFor: normalizedUrl
    });
  }

  async clearHostPermissionRecoveryState() {
    if (!chrome.storage?.local) {
      return;
    }

    const result = this.normalizeStorageResult(
      await chrome.storage.local.get(['lastErrorCode'])
    );

    await chrome.storage.local.remove([
      'hostPermissionRecoveryRequired',
      'hostPermissionRecoveryUrl',
      'hostPermissionRecoveryOrigin',
      'hostPermissionRecoveryNotifiedFor'
    ]);

    if (chrome.notifications?.clear) {
      chrome.notifications.clear(HOST_PERMISSION_RECOVERY_NOTIFICATION_ID, () => {});
    }

    if (result.lastErrorCode === 'hostPermissionRequired') {
      await chrome.storage.local.set({
        lastError: null,
        lastErrorCode: null,
        lastErrorTime: null,
        shouldRetry: null
      });

      const unreadCount = Array.from(this.notifications.values()).filter(notification => !notification.read).length;
      this.updateBadge(unreadCount);
      chrome.action.setTitle({
        title: this.getFallbackTranslation('extName', 'MewMewNotification')
      });
    }
  }

  async syncHostPermissionRecoveryState({ notify = false } = {}) {
    const permissionState = this.getConfiguredHostPermissionState();
    if (!permissionState.configured || !permissionState.valid || !chrome.permissions?.contains || !permissionState.permissionRequest) {
      await this.clearHostPermissionRecoveryState();
      return;
    }

    const hasPermission = await chrome.permissions.contains(permissionState.permissionRequest);
    if (hasPermission) {
      await this.clearHostPermissionRecoveryState();
      return;
    }

    const errorMessage = this.getFallbackTranslation(
      'hostPermissionRequired',
      'Grant host access for the configured Redmine server before syncing'
    );

    await chrome.storage.local.set({
      hostPermissionRecoveryRequired: true,
      hostPermissionRecoveryUrl: permissionState.validation.normalizedUrl,
      hostPermissionRecoveryOrigin: permissionState.validation.originPattern,
      lastError: errorMessage,
      lastErrorCode: 'hostPermissionRequired',
      lastErrorTime: Date.now(),
      shouldRetry: false
    });

    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
    chrome.action.setTitle({ title: `Error: ${errorMessage}` });

    if (notify) {
      await this.notifyHostPermissionRecovery(permissionState.validation.normalizedUrl);
    }
  }

  async ensureConfiguredHostAccess() {
    const permissionState = this.getConfiguredHostPermissionState();
    if (!permissionState.configured) {
      return;
    }

    if (!permissionState.valid) {
      throw new Error(permissionState.errorMessage);
    }

    if (!chrome.permissions?.contains || !permissionState.permissionRequest) {
      return;
    }

    const hasPermission = await chrome.permissions.contains(permissionState.permissionRequest);

    if (!hasPermission) {
      throw new Error('hostPermissionRequired');
    }
  }

  async createApiClient() {
    await this.ensureSettingsLoaded();

    if (!this.settings.redmineUrl || !this.settings.apiKey) {
      throw new Error('missingRequiredSettings');
    }

    await this.ensureConfiguredHostAccess();
    return new RedmineAPI(this.settings.redmineUrl, this.settings.apiKey);
  }

  buildNotificationFromIssue(issue, existingNotification = {}) {
    const lastSeenState = existingNotification.lastSeenState || this.buildIssueSnapshot(issue);

    return {
      id: `issue_${issue.id}`,
      issueId: issue.id,
      title: `#${issue.id}: ${issue.subject}`,
      project: issue.project?.name || this.translate('unknownProject'),
      author: issue.author?.name || this.translate('unknownAuthor'),
      status: issue.status?.name || this.translate('unknownStatus'),
      priority: issue.priority?.name || this.translate('normalPriority'),
      assigneeId: issue.assigned_to?.id,
      assigneeName: issue.assigned_to?.name || '',
      projectId: issue.project?.id,
      updatedOn: new Date(issue.updated_on),
      url: `${this.settings.redmineUrl}/issues/${issue.id}`,
      read: existingNotification.read === true,
      isUpdated: existingNotification.isUpdated === true,
      sourceType: issue.sourceType || existingNotification.sourceType || 'unknown',
      changeSummary: this.normalizeChangeSummary(existingNotification.changeSummary),
      lastSeenState
    };
  }

  buildIssueSnapshot(issue) {
    return {
      subject: typeof issue?.subject === 'string' ? issue.subject : '',
      status: typeof issue?.status?.name === 'string' ? issue.status.name : '',
      priority: typeof issue?.priority?.name === 'string' ? issue.priority.name : '',
      assigneeId: Number.isInteger(issue?.assigned_to?.id) ? issue.assigned_to.id : undefined,
      assigneeName: typeof issue?.assigned_to?.name === 'string' ? issue.assigned_to.name : '',
      updatedOn: new Date(issue?.updated_on).getTime()
    };
  }

  buildIssueChangeSummary(previousState, currentState) {
    const previousSnapshot = this.normalizeIssueSnapshot(previousState);
    const currentSnapshot = this.normalizeIssueSnapshot(currentState);

    if (!previousSnapshot || !currentSnapshot) {
      return [];
    }

    const changes = [];
    const compareTextField = (field, fromValue, toValue) => {
      const normalizedFrom = fromValue || '';
      const normalizedTo = toValue || '';
      if (normalizedFrom !== normalizedTo) {
        changes.push({
          field,
          from: normalizedFrom,
          to: normalizedTo
        });
      }
    };

    compareTextField('subject', previousSnapshot.subject, currentSnapshot.subject);
    compareTextField('status', previousSnapshot.status, currentSnapshot.status);
    compareTextField('priority', previousSnapshot.priority, currentSnapshot.priority);

    if (
      previousSnapshot.assigneeId !== currentSnapshot.assigneeId ||
      previousSnapshot.assigneeName !== currentSnapshot.assigneeName
    ) {
      changes.push({
        field: 'assignee',
        from: previousSnapshot.assigneeName,
        to: currentSnapshot.assigneeName
      });
    }

    return changes;
  }

  async persistIssueState(issue) {
    const result = this.normalizeStorageResult(
      await chrome.storage.local.get(['issueStates'])
    );
    const issueStates = result.issueStates || {};

    issueStates[issue.id] = this.buildIssueSnapshot(issue);

    await chrome.storage.local.set({ issueStates });
  }

  async syncUpdatedIssue(issue) {
    const notificationId = `issue_${issue.id}`;
    const existingNotification = this.notifications.get(notificationId) || {};
    const syncedNotification = this.buildNotificationFromIssue(issue, {
      ...existingNotification,
      isUpdated: false
    });

    this.notifications.set(notificationId, syncedNotification);
    await this.persistIssueState(issue);
    await this.mergeNotificationHistory([syncedNotification], {
      readNotificationIds: this.settings.readNotifications
    });

    const retainedHistory = await this.loadNotificationHistory();
    const unreadCount = retainedHistory
      .filter(notification => !notification.read)
      .length;
    this.updateBadge(unreadCount);

    return syncedNotification;
  }

  formatIssueActionContext(context) {
    return {
      permissions: context.permissions,
      current: context.current,
      statusOptions: context.statusOptions,
      assigneeOptions: context.assigneeOptions
    };
  }

  resolveIssueActionError(error) {
    if (typeof error?.message === 'string') {
      if (/403|forbidden/i.test(error.message)) {
        return this.translate('permissionDenied');
      }

      if (/Reply content is required/i.test(error.message)) {
        return this.translate('replyRequired');
      }

      if (/Reply content is too long/i.test(error.message)) {
        return this.translate('replyTooLong');
      }

      if (/Invalid (issue|status|assignee) id/i.test(error.message)) {
        return this.translate('issueActionValidationError');
      }

      if (/No issue changes provided/i.test(error.message)) {
        return this.translate('noChangesToSubmit');
      }
    }

    return this.resolveErrorMessage(error.message || String(error));
  }

  async getIssueActionContext(issueId) {
    try {
      const api = await this.createApiClient();
      const context = await api.getIssueActionContext(issueId);

      return {
        success: true,
        context: this.formatIssueActionContext(context)
      };
    } catch (error) {
      return {
        success: false,
        error: this.resolveIssueActionError(error)
      };
    }
  }

  async executeIssueAction(issueId, actionCallback) {
    try {
      const api = await this.createApiClient();
      await actionCallback(api);

      const context = await api.getIssueActionContext(issueId);
      const notification = await this.syncUpdatedIssue(context.issue);

      return {
        success: true,
        notification,
        context: this.formatIssueActionContext(context)
      };
    } catch (error) {
      return {
        success: false,
        error: this.resolveIssueActionError(error)
      };
    }
  }

  async applyIssueChanges(issueId, changes) {
    return this.executeIssueAction(issueId, api => api.applyIssueChanges(issueId, changes));
  }

  async checkNotifications() {
    await this.ensureSettingsLoaded();

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
      const result = this.normalizeStorageResult(
        await chrome.storage.local.get(['issueStates'])
      );
      const previousIssueStates = result.issueStates || {};
      const existingHistory = await this.loadNotificationHistory();
      const existingHistoryById = new Map(existingHistory.map(record => [record.id, record]));

      console.log('Previous issue states count:', Object.keys(previousIssueStates).length);
      console.log('Current issues count:', issues.length);

      // Clear error state if successful
      await chrome.storage.local.set({ lastError: null, lastErrorCode: null, lastErrorTime: null });
      
      // Create a copy of readNotifications to avoid modifying the original during iteration
      const readNotificationsCopy = [...this.settings.readNotifications];
      const updatedReadNotifications = [...this.settings.readNotifications];
      
      for (const issue of issues) {
        const notificationId = `issue_${issue.id}`;
        const existingRecord = existingHistoryById.get(notificationId) || this.notifications.get(notificationId) || {};
        const isRead = readNotificationsCopy.includes(notificationId) || existingRecord.read === true;
        const currentUpdateTime = new Date(issue.updated_on).getTime();
        const previousState = previousIssueStates[issue.id];
        const currentState = this.buildIssueSnapshot(issue);
        const changeSummary = this.buildIssueChangeSummary(previousState, currentState);
        
        const notification = this.buildNotificationFromIssue(issue, {
          ...existingRecord,
          read: isRead,
          isUpdated: false,
          sourceType: issue.sourceType || existingRecord.sourceType || 'unknown',
          changeSummary: [],
          lastSeenState: currentState
        });

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
            notification.changeSummary = changeSummary;
            
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
        previousIssueStates[issue.id] = currentState;
      }
      
      // Update read notifications in storage only once after processing all issues
      if (updatedReadNotifications.length !== this.settings.readNotifications.length) {
        this.settings.readNotifications = updatedReadNotifications;
        await chrome.storage.sync.set({ readNotifications: updatedReadNotifications });
      }

      // Save updated issue states
      await chrome.storage.local.set({ issueStates: previousIssueStates });
      await this.mergeNotificationHistory(
        Array.from(this.notifications.values()),
        { readNotificationIds: updatedReadNotifications }
      );

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
      let errorCode = null;
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
        errorCode = 'hostPermissionRequired';
        await this.syncHostPermissionRecoveryState({ notify: true });
      }
      
      // Store error information for debugging
      await chrome.storage.local.set({ 
        lastError: errorMessage,
        lastErrorCode: errorCode,
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
    const result = this.normalizeStorageResult(
      await chrome.storage.local.get(['seenNotifications'])
    );
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
    }

    const result = this.normalizeStorageResult(
      await chrome.storage.sync.get(['readNotifications'])
    );
    const readNotifications = result.readNotifications || [];
    
    if (!readNotifications.includes(notificationId)) {
      readNotifications.push(notificationId);
      await chrome.storage.sync.set({ readNotifications });
    }

    const history = await this.loadNotificationHistory();
    const updatedHistory = history.map(record => (
      record.id === notificationId ? { ...record, read: true } : record
    ));
    await this.saveNotificationHistory(updatedHistory);

    // Update badge
    const unreadCount = updatedHistory.filter(n => !n.read).length;
    this.updateBadge(unreadCount);
  }

  async markAllAsRead() {
    const history = await this.loadNotificationHistory();
    const unreadNotifications = Array.from(this.notifications.values()).filter(n => !n.read);
    const result = this.normalizeStorageResult(
      await chrome.storage.sync.get(['readNotifications'])
    );
    const readNotifications = result.readNotifications || [];

    for (const notification of unreadNotifications) {
      notification.read = true;
      if (!readNotifications.includes(notification.id)) {
        readNotifications.push(notification.id);
      }
    }

    const updatedHistory = history.map(record => {
      if (!readNotifications.includes(record.id)) {
        readNotifications.push(record.id);
      }

      return { ...record, read: true };
    });

    await chrome.storage.sync.set({ readNotifications });
    await this.saveNotificationHistory(updatedHistory);
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

  async getNotifications() {
    const history = await this.loadNotificationHistory();
    if (history.length > 0) {
      return history;
    }

    return Array.from(this.notifications.values()).sort((a, b) => b.updatedOn - a.updatedOn);
  }
}

// Background script logic
const notificationManager = new NotificationManager();
const ALARM_NAME = 'redmine-notification-check';

function startPeriodicCheck() {
  stopPeriodicCheck();
  
  notificationManager.loadSettings({ notifyPermissionRecovery: true }).then(() => {
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
  const getErrorMessage = error => error?.message || String(error);

  const handleAsyncResponse = (task, errorMapper = getErrorMessage) => {
    (async () => {
      try {
        const result = await task();
        sendResponse(result);
      } catch (error) {
        console.error(`Message handler failed for action: ${request.action}`, error);
        const fallbackErrorMessage = getErrorMessage(error);
        let mappedErrorMessage;

        try {
          mappedErrorMessage = errorMapper(error);
        } catch (mappingError) {
          mappedErrorMessage = getErrorMessage(mappingError) || fallbackErrorMessage;
        }

        sendResponse({
          success: false,
          error: mappedErrorMessage || fallbackErrorMessage
        });
      }
    })();

    return true;
  };

  switch (request.action) {
    case 'getNotifications':
      return handleAsyncResponse(async () => ({
        notifications: await notificationManager.getNotifications()
      }));
      
    case 'markAsRead':
      return handleAsyncResponse(async () => {
        await notificationManager.markAsRead(request.notificationId);
        return { success: true };
      });
      
    case 'markAllAsRead':
      return handleAsyncResponse(async () => {
        await notificationManager.markAllAsRead();
        return { success: true };
      });
      
    case 'testConnection':
      if (!request.redmineUrl || !request.apiKey) {
        sendResponse({ success: false, error: notificationManager.translate('missingRequiredSettings') });
        return;
      }
      
      const api = new RedmineAPI(request.redmineUrl, request.apiKey);
      return handleAsyncResponse(() => api.testConnection());
      
    case 'refreshNotifications':
      return handleAsyncResponse(async () => {
        await notificationManager.checkNotifications();
        return { success: true, notifications: await notificationManager.getNotifications() };
      });
      
    case 'forceRefreshNotifications':
      return handleAsyncResponse(async () => {
        await notificationManager.forceRefreshNotifications();
        return { success: true, notifications: await notificationManager.getNotifications() };
      });
      
    case 'clearAllNotifications':
      return handleAsyncResponse(async () => {
        await notificationManager.clearAllNotifications();
        return { success: true };
      });

    case 'getIssueActionContext':
      return handleAsyncResponse(
        () => notificationManager.getIssueActionContext(request.issueId),
        error => notificationManager.resolveIssueActionError(error)
      );

    case 'applyIssueChanges':
      return handleAsyncResponse(
        () => notificationManager.applyIssueChanges(request.issueId, request.changes),
        error => notificationManager.resolveIssueActionError(error)
      );
      
    case 'getSettings':
      // Add a debug endpoint to check current settings
      return handleAsyncResponse(async () => {
        await notificationManager.loadSettings();
        const alarm = await new Promise(resolve => {
          chrome.alarms.get(ALARM_NAME, currentAlarm => {
            resolve(currentAlarm);
          });
        });

        const safeSettings = {
          ...notificationManager.settings,
          apiKey: notificationManager.settings.apiKey ? '[CONFIGURED]' : '[NOT_CONFIGURED]'
        };

        return { 
          success: true, 
          settings: safeSettings,
          alarmActive: !!alarm,
          alarmInfo: alarm || null
        };
      });

    default:
      sendResponse({
        success: false,
        error: `Unknown action: ${request.action}`
      });
      return false;
  }
});

// Notification click handler
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === HOST_PERMISSION_RECOVERY_NOTIFICATION_ID && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }

  chrome.action.openPopup();
});

// Start the periodic check
startPeriodicCheck();
