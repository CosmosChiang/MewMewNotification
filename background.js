if (typeof importScripts === 'function') {
  importScripts('scripts/shared/config-manager.js', 'scripts/shared/profile-state-manager.js');
}

const HOST_PERMISSION_RECOVERY_NOTIFICATION_ID = 'host-permission-recovery';
const NOTIFICATION_HISTORY_STORAGE_KEY = 'notificationHistory';
const MAX_NOTIFICATION_HISTORY_ITEMS = 100;
const NOTIFICATION_PROJECT_CACHE_STORAGE_KEY = 'notificationProjectMetadataCache';
const NOTIFICATION_PROJECT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;
const MAX_REQUEST_RETRIES = 3;
const MAX_READ_NOTIFICATIONS = 1000;
const REQUEST_TIMEOUT_MS = 30000;
const WORKER_SAFE_RETRY_SECONDS = 5;
const RETRY_ALARM_NAME = 'redmine-notification-retry';
const RETRY_METADATA_KEY = 'notificationRetryV1';
const API_PAGE_SIZE = 100;
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;
const MAX_ISSUE_STATES = 5000;
const RECONCILIATION_BUDGET = 20;
const FULL_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DESKTOP_MAPPING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DESKTOP_MAPPINGS = 100;

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
    this.maxCacheSize = MAX_CACHE_SIZE;
    this.lastSyncTime = null;
    this.defaultRetryCount = 0;
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
    if (!this.cache.has(key) && this.cache.size >= this.maxCacheSize) {
      this._evictOldestCacheEntry();
    }

    this.cache.set(key, value);
    this.cacheExpiry.set(key, Date.now() + ttl);
  }

  _evictOldestCacheEntry() {
    let oldestKey;
    let oldestExpiry = Infinity;

    for (const [key, expiry] of this.cacheExpiry) {
      if (expiry < oldestExpiry) {
        oldestKey = key;
        oldestExpiry = expiry;
      }
    }

    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      this.cacheExpiry.delete(oldestKey);
    }
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

  async makeRequest(endpoint, options = {}, retryCount = this.defaultRetryCount) {
    // Security validation
    this.validateApiEndpoint(endpoint);
    
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'X-Redmine-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('connectionTimeout'), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      if (response.status === 429) {
        if (retryCount >= MAX_REQUEST_RETRIES) {
          throw new Error('rateLimitRetryExceeded');
        }

        // Rate limited - wait and retry
        const retryAfter = Math.min(Number.parseInt(response.headers.get('Retry-After'), 10) || 60, 300);
        if (retryAfter > WORKER_SAFE_RETRY_SECONDS) {
          const error = new Error('rateLimitRetryScheduled');
          error.retryAfterSeconds = retryAfter;
          error.retryCount = retryCount + 1;
          throw error;
        }
        console.warn(`Rate limited. Waiting ${retryAfter} seconds before retry.`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.makeRequest(endpoint, options, retryCount + 1);
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
        } catch (_e) {
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
            } catch (_e) {
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
      } catch (_parseError) {
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
      if (error.name === 'AbortError' || controller.signal.aborted) {
        const timeoutError = new Error('connectionTimeout');
        timeoutError.code = options.method && options.method !== 'GET' ? 'outcomeUnknown' : 'connectionTimeout';
        throw timeoutError;
      }
      
      // Handle network errors with retry logic
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.warn('Network error, will retry on next check cycle');
      }
      
      throw error;
    } finally {
      clearTimeout(timeoutId);
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

  async getIssuesLossless({ onlyMyProjects = true, includeWatchedIssues = false, cursor = null } = {}) {
    const currentUser = await this.getCurrentUser();
    const sources = [];
    if (onlyMyProjects) sources.push({ assigned_to_id: currentUser.id, sourceType: 'assigned' });
    if (includeWatchedIssues) sources.push({ watcher_id: currentUser.id, sourceType: 'watched' });
    if (sources.length === 0) sources.push({ sourceType: 'all' });
    const byEvent = new Map();
    for (const source of sources) {
      let offset = 0;
      let totalCount = Infinity;
      while (offset < totalCount) {
        const params = new URLSearchParams({ status_id: '*', sort: 'updated_on:asc,id:asc', limit: String(API_PAGE_SIZE), offset: String(offset) });
        if (source.assigned_to_id) params.set('assigned_to_id', String(source.assigned_to_id));
        if (source.watcher_id) params.set('watcher_id', String(source.watcher_id));
        if (cursor) params.set('updated_on', `>=${new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString()}`);
        const response = await this.request(`/issues.json?${params.toString()}`);
        const page = Array.isArray(response.issues) ? response.issues : [];
        totalCount = Number.isFinite(response.total_count) ? response.total_count : offset + page.length;
        page.forEach(issue => {
          const key = `${issue.id}:${new Date(issue.updated_on).toISOString()}`;
          if (!byEvent.has(key)) byEvent.set(key, { ...issue, sourceType: source.sourceType });
        });
        if (!page.length) break;
        offset += Number(response.limit) || API_PAGE_SIZE;
      }
    }
    const issues = Array.from(byEvent.values()).sort((a, b) => new Date(a.updated_on) - new Date(b.updated_on) || a.id - b.id);
    return { issues, total_count: issues.length, offset: 0, limit: API_PAGE_SIZE };
  }

  async reconcileIssueIds(issueIds) {
    const results = [];
    for (const issueId of issueIds.slice(0, RECONCILIATION_BUDGET)) {
      try {
        const response = await this.request(`/issues/${issueId}.json`);
        if (response.issue) results.push({ ...response.issue, sourceType: 'reconciled' });
      } catch (error) {
        if (/not found|forbidden|404|403/i.test(error.message)) results.push({ id: Number(issueId), unavailable: true, sourceType: 'reconciled', errorCode: 'unavailable' });
        else throw error;
      }
    }
    return results;
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

  async getProjects() {
    const allProjects = [];
    const pageSize = 100;
    let offset = 0;

    while (true) {
      const queryParams = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset)
      });
      const response = await this.request(`/projects.json?${queryParams.toString()}`);
      const projects = Array.isArray(response.projects) ? response.projects : [];
      const totalCount = Number.isSafeInteger(response.total_count)
        ? response.total_count
        : projects.length;

      allProjects.push(...projects);

      if (projects.length === 0 || allProjects.length >= totalCount || projects.length < pageSize) {
        break;
      }

      offset += projects.length;
    }

    return {
      projects: allProjects
    };
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
    const profileStateManagerClass = globalThis.ProfileStateManager;
    this.profileState = profileStateManagerClass ? new profileStateManagerClass(chrome.storage) : null;
    this.activeProfile = null;
    this.checkPromise = null;
    this.loadSettings().catch(error => {
      console.error('Failed to preload settings:', error);
    });
    this.loadLanguage();
  }

  getDefaultSettings() {
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.normalizeRuntimeSettings) {
      return configManagerClass.normalizeRuntimeSettings({}, {});
    }

    return {
      redmineUrl: '',
      apiKey: '',
      checkInterval: 15,
      enableNotifications: true,
      enableSound: true,
      maxNotifications: 50,
      readNotifications: [],
      onlyMyProjects: true,
      includeWatchedIssues: false
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

  normalizeProjectMetadataRecord(project) {
    if (!project || typeof project !== 'object' || !Number.isInteger(project.id)) {
      return undefined;
    }

    const trimmedName = typeof project.name === 'string' ? project.name.trim() : '';
    if (!trimmedName) {
      return undefined;
    }

    return {
      id: project.id,
      name: trimmedName,
      identifier: typeof project.identifier === 'string' ? project.identifier.trim() : ''
    };
  }

  normalizeProjectMetadataRecords(projects) {
    if (!Array.isArray(projects)) {
      return [];
    }

    return projects
      .map(project => this.normalizeProjectMetadataRecord(project))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  }

  async loadCachedNotificationProjects(redmineUrl) {
    if (this.activeProfile && this.profileState) {
      const cacheEntry = await this.profileState.read(this.activeProfile.profileId, 'projectCache', null);
      if (!cacheEntry || cacheEntry.redmineUrl !== redmineUrl) return undefined;
      const fetchedAt = Number(cacheEntry.fetchedAt);
      if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > NOTIFICATION_PROJECT_CACHE_TTL_MS) return undefined;
      return { cached: true, projects: this.normalizeProjectMetadataRecords(cacheEntry.projects) };
    }
    const result = this.normalizeStorageResult(
      await chrome.storage.local.get([NOTIFICATION_PROJECT_CACHE_STORAGE_KEY])
    );
    const cacheEntry = result[NOTIFICATION_PROJECT_CACHE_STORAGE_KEY];
    if (!cacheEntry || typeof cacheEntry !== 'object' || cacheEntry.redmineUrl !== redmineUrl) {
      return undefined;
    }

    const fetchedAt = Number.isFinite(cacheEntry.fetchedAt)
      ? cacheEntry.fetchedAt
      : Date.parse(cacheEntry.fetchedAt);
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > NOTIFICATION_PROJECT_CACHE_TTL_MS) {
      return undefined;
    }

    return {
      cached: true,
      projects: this.normalizeProjectMetadataRecords(cacheEntry.projects)
    };
  }

  async saveNotificationProjectsCache(redmineUrl, projects) {
    const normalizedProjects = this.normalizeProjectMetadataRecords(projects);
    const cacheEntry = { redmineUrl, fetchedAt: Date.now(), projects: normalizedProjects };
    if (this.activeProfile && this.profileState) {
      await this.profileState.write(this.activeProfile.profileId, 'projectCache', cacheEntry);
    } else {
      await chrome.storage.local.set({ [NOTIFICATION_PROJECT_CACHE_STORAGE_KEY]: cacheEntry });
    }

    return normalizedProjects;
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
      profileId: typeof record.profileId === 'string' ? record.profileId : '',
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
      bundleCount: Number.isSafeInteger(record.bundleCount) && record.bundleCount > 0
        ? record.bundleCount
        : 1,
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
    if (this.activeProfile && this.profileState) {
      const history = await this.profileState.read(this.activeProfile.profileId, 'history', []);
      return this.applyNotificationHistoryRetention(history);
    }
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

    if (this.activeProfile && this.profileState) {
      await this.profileState.write(this.activeProfile.profileId, 'history', serializedHistory);
    } else {
      await chrome.storage.local.set({ [this.notificationHistoryStorageKey]: serializedHistory });
    }

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
    const settingsAtStart = this.settings;
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.migrateLegacyApiKey) {
      await configManagerClass.migrateLegacyApiKey();
    }

    const [syncResult, localResult] = await Promise.all([
      chrome.storage.sync.get(
        configManagerClass?.getSyncSettingKeys
          ? configManagerClass.getSyncSettingKeys()
          : [
              'redmineUrl',
              'checkInterval',
              'enableNotifications',
              'enableSound',
              'maxNotifications',
              'readNotifications',
              'onlyMyProjects',
              'includeWatchedIssues'
            ]
      ),
      chrome.storage.local.get(['apiKey'])
    ]);

    const loadedSettings = configManagerClass?.normalizeRuntimeSettings
      ? configManagerClass.normalizeRuntimeSettings(syncResult, localResult)
      : this.getDefaultSettings();
    // Do not let an older asynchronous load overwrite settings explicitly replaced
    // while storage reads were in flight (for example immediately after saving credentials).
    if (this.settings !== settingsAtStart) return this.settings;
    this.settings = loadedSettings;
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
      includeWatchedIssues: this.settings.includeWatchedIssues,
      notificationProjectRules: this.settings.notificationProjectRules,
      notificationChangeFilters: this.settings.notificationChangeFilters,
      notificationQuietHours: this.settings.notificationQuietHours,
      notificationBundling: this.settings.notificationBundling
    });
  }

  async ensureSettingsLoaded() {
    if (this.settingsLoaded) {
      return this.settings;
    }

    await this.loadSettings();
    return this.settings;
  }

  async resolveActiveProfile(apiClient) {
    if (!this.profileState) return null;
    const api = apiClient || await this.createApiClient();
    const user = await api.getCurrentUser();
    const identity = await this.profileState.createProfileIdentity(
      this.settings.redmineUrl, user.id, this.settings.apiKey
    );
    if (this.activeProfile?.profileId === identity.profileId) return this.activeProfile;
    if (this.activeProfile?.profileId && this.activeProfile.profileId !== identity.profileId) {
      await this.clearRetryMetadata();
    }
    this.activeProfile = await this.profileState.initializeAndActivate(identity);
    this.settings.readNotifications = await this.profileState.read(identity.profileId, 'readIds', []);
    this.notifications.clear();
    return this.activeProfile;
  }

  async restoreActiveProfile() {
    if (!this.profileState || !this.settings.redmineUrl) return null;
    const restored = await this.profileState.restoreActiveProfile(this.settings.redmineUrl);
    if (restored) {
      this.activeProfile = restored;
      this.settings.readNotifications = await this.profileState.read(restored.profileId, 'readIds', []);
    }
    return restored;
  }

  async requireProfile(profileId = this.activeProfile?.profileId) {
    if (!this.activeProfile) await this.resolveActiveProfile();
    await this.profileState?.assertActiveProfile(profileId);
    return this.activeProfile;
  }

  async assertNotificationOwnership(notificationId, profileId) {
    await this.requireProfile(profileId);
    if (!notificationId) return;
    const history = await this.loadNotificationHistory();
    const record = this.notifications.get(notificationId) || history.find(item => item.id === notificationId);
    if (!record || record.profileId !== this.activeProfile.profileId) throw new Error('profileMismatch');
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

  async getNotificationProjects({ forceRefresh = false } = {}) {
    await this.ensureSettingsLoaded();

    if (!this.settings.redmineUrl || !this.settings.apiKey) {
      throw new Error('missingRequiredSettings');
    }

    const api = await this.createApiClient();
    await this.restoreActiveProfile();
    if (!this.activeProfile) await this.resolveActiveProfile(api);

    if (!forceRefresh) {
      const cachedProjects = await this.loadCachedNotificationProjects(this.settings.redmineUrl);
      if (cachedProjects) {
        return cachedProjects;
      }
    }

    const response = await api.getProjects();
    const projects = await this.saveNotificationProjectsCache(this.settings.redmineUrl, response.projects);

    return {
      cached: false,
      projects
    };
  }

  buildNotificationFromIssue(issue, existingNotification = {}) {
    const lastSeenState = existingNotification.lastSeenState || this.buildIssueSnapshot(issue);
    const updatedOn = new Date(issue.updated_on);

    return {
      id: typeof existingNotification.id === 'string' && existingNotification.id
        ? existingNotification.id
        : this.createNotificationRecordId(issue, updatedOn),
      issueId: issue.id,
      profileId: this.activeProfile?.profileId || existingNotification.profileId || '',
      title: `#${issue.id}: ${issue.subject}`,
      project: issue.project?.name || this.translate('unknownProject'),
      author: issue.author?.name || this.translate('unknownAuthor'),
      status: issue.status?.name || this.translate('unknownStatus'),
      priority: issue.priority?.name || this.translate('normalPriority'),
      assigneeId: issue.assigned_to?.id,
      assigneeName: issue.assigned_to?.name || '',
      projectId: issue.project?.id,
      updatedOn,
      url: `${this.settings.redmineUrl}/issues/${issue.id}`,
      read: existingNotification.read === true,
      isUpdated: existingNotification.isUpdated === true,
      bundleCount: Number.isSafeInteger(existingNotification.bundleCount) && existingNotification.bundleCount > 0
        ? existingNotification.bundleCount
        : 1,
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

  getNotificationProjectRules() {
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.normalizeNotificationProjectRules) {
      return configManagerClass.normalizeNotificationProjectRules(this.settings?.notificationProjectRules);
    }

    return {
      mode: 'all',
      includeProjectIds: [],
      excludeProjectIds: []
    };
  }

  getNotificationChangeFilters() {
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.normalizeNotificationChangeFilters) {
      return configManagerClass.normalizeNotificationChangeFilters(this.settings?.notificationChangeFilters);
    }

    return {
      status: true,
      assignee: true,
      priority: true,
      comment: true,
      generic: true
    };
  }

  getNotificationQuietHours() {
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.normalizeNotificationQuietHours) {
      return configManagerClass.normalizeNotificationQuietHours(this.settings?.notificationQuietHours);
    }

    return {
      enabled: false,
      start: '22:00',
      end: '08:00'
    };
  }

  getNotificationBundling() {
    const configManagerClass = globalThis.ConfigManager;
    if (configManagerClass?.normalizeNotificationBundling) {
      return configManagerClass.normalizeNotificationBundling(this.settings?.notificationBundling);
    }

    return {
      enabled: false,
      windowMinutes: 5
    };
  }

  createNotificationRecordId(issue, updatedOn = issue?.updated_on) {
    const normalizedIssueId = Number.isInteger(issue?.id)
      ? issue.id
      : Number.parseInt(issue?.issueId, 10);
    const bundling = this.getNotificationBundling();

    if (!bundling.enabled || !Number.isSafeInteger(normalizedIssueId) || normalizedIssueId <= 0) {
      return `issue_${normalizedIssueId}`;
    }

    const updatedTimestamp = updatedOn instanceof Date
      ? updatedOn.getTime()
      : Number.isFinite(updatedOn)
        ? updatedOn
        : new Date(updatedOn).getTime();

    return `issue_${normalizedIssueId}_${Number.isFinite(updatedTimestamp) ? updatedTimestamp : Date.now()}`;
  }

  getNotificationsForIssue(issueId) {
    const normalizedIssueId = Number.parseInt(issueId, 10);
    if (!Number.isSafeInteger(normalizedIssueId) || normalizedIssueId <= 0) {
      return [];
    }

    return Array.from(this.notifications.values())
      .filter(notification => notification.issueId === normalizedIssueId)
      .sort((left, right) => right.updatedOn - left.updatedOn);
  }

  findLatestNotificationForIssue(issueId) {
    return this.getNotificationsForIssue(issueId)[0];
  }

  findBundlingTarget(issueId, updatedOn) {
    const bundling = this.getNotificationBundling();
    if (!bundling.enabled) {
      return undefined;
    }

    const updatedTimestamp = updatedOn instanceof Date
      ? updatedOn.getTime()
      : Number.isFinite(updatedOn)
        ? updatedOn
        : new Date(updatedOn).getTime();
    if (!Number.isFinite(updatedTimestamp)) {
      return undefined;
    }

    const bundlingWindowMs = bundling.windowMinutes * 60 * 1000;

    return this.getNotificationsForIssue(issueId).find(notification => {
      const notificationTimestamp = notification.updatedOn instanceof Date
        ? notification.updatedOn.getTime()
        : new Date(notification.updatedOn).getTime();

      return Number.isFinite(notificationTimestamp)
        && updatedTimestamp >= notificationTimestamp
        && updatedTimestamp - notificationTimestamp <= bundlingWindowMs;
    });
  }

  mergeChangeSummary(existingSummary, nextSummary) {
    const mergedByField = new Map();

    this.normalizeChangeSummary(existingSummary).forEach(change => {
      mergedByField.set(change.field, { ...change });
    });

    this.normalizeChangeSummary(nextSummary).forEach(change => {
      const existingChange = mergedByField.get(change.field);
      if (!existingChange) {
        mergedByField.set(change.field, { ...change });
        return;
      }

      mergedByField.set(change.field, {
        field: change.field,
        from: existingChange.from || change.from,
        to: change.to
      });
    });

    return Array.from(mergedByField.values());
  }

  isProjectNotificationEligible(projectId) {
    const projectRules = this.getNotificationProjectRules();
    const normalizedProjectId = Number.parseInt(projectId, 10);
    const hasProjectId = Number.isSafeInteger(normalizedProjectId) && normalizedProjectId > 0;

    if (projectRules.mode === 'include') {
      return hasProjectId && projectRules.includeProjectIds.includes(normalizedProjectId);
    }

    if (projectRules.mode === 'exclude') {
      return !hasProjectId || !projectRules.excludeProjectIds.includes(normalizedProjectId);
    }

    return true;
  }

  hasExplicitCommentActivity(issue) {
    if (!issue || typeof issue !== 'object') {
      return false;
    }

    const directNoteFields = ['notes', 'last_notes', 'lastNotes', 'journalNotes', 'lastJournalNotes'];
    if (directNoteFields.some(field => typeof issue[field] === 'string' && issue[field].trim())) {
      return true;
    }

    if (!Array.isArray(issue.journals)) {
      return false;
    }

    return issue.journals.some(journal => (
      journal
      && typeof journal === 'object'
      && typeof journal.notes === 'string'
      && journal.notes.trim()
    ));
  }

  classifyIssueUpdate(previousState, currentState, issue) {
    const changeSummary = this.buildIssueChangeSummary(previousState, currentState);
    const categories = new Set();

    changeSummary.forEach(change => {
      if (change.field === 'status' || change.field === 'assignee' || change.field === 'priority') {
        categories.add(change.field);
      }
    });

    if (this.hasExplicitCommentActivity(issue)) {
      categories.add('comment');
    }

    if (categories.size === 0) {
      categories.add('generic');
    }

    return Array.from(categories);
  }

  areNotificationChangeCategoriesEnabled(changeCategories) {
    const changeFilters = this.getNotificationChangeFilters();
    const normalizedCategories = Array.isArray(changeCategories) && changeCategories.length > 0
      ? changeCategories
      : ['generic'];

    return normalizedCategories.some(category => {
      if (Object.prototype.hasOwnProperty.call(changeFilters, category)) {
        return changeFilters[category] !== false;
      }

      return changeFilters.generic !== false;
    });
  }

  isWithinQuietHours(referenceTime = new Date()) {
    const quietHours = this.getNotificationQuietHours();
    if (!quietHours.enabled) {
      return false;
    }

    const [startHour, startMinute] = quietHours.start.split(':').map(value => Number.parseInt(value, 10));
    const [endHour, endMinute] = quietHours.end.split(':').map(value => Number.parseInt(value, 10));
    const startTotalMinutes = (startHour * 60) + startMinute;
    const endTotalMinutes = (endHour * 60) + endMinute;

    if (startTotalMinutes === endTotalMinutes) {
      return false;
    }

    const currentTotalMinutes = (referenceTime.getHours() * 60) + referenceTime.getMinutes();

    if (startTotalMinutes < endTotalMinutes) {
      return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;
    }

    return currentTotalMinutes >= startTotalMinutes || currentTotalMinutes < endTotalMinutes;
  }

  evaluateNotificationCandidate(issue, previousState, currentState) {
    if (!this.isProjectNotificationEligible(issue?.project?.id)) {
      return {
        retain: false,
        deliver: false,
        reason: 'project'
      };
    }

    if (!previousState) {
      const quietHoursSuppressed = this.isWithinQuietHours();

      return {
        retain: true,
        deliver: !quietHoursSuppressed,
        quietHoursSuppressed,
        changeCategories: []
      };
    }

    const changeCategories = this.classifyIssueUpdate(previousState, currentState, issue);
    if (!this.areNotificationChangeCategoriesEnabled(changeCategories)) {
      return {
        retain: false,
        deliver: false,
        reason: 'change-filter',
        changeCategories
      };
    }

    const quietHoursSuppressed = this.isWithinQuietHours();

    return {
      retain: true,
      deliver: !quietHoursSuppressed,
      quietHoursSuppressed,
      changeCategories
    };
  }

  async syncUpdatedIssue(issue) {
    const currentState = this.buildIssueSnapshot(issue);
    const bundlingTarget = this.findBundlingTarget(issue.id, currentState.updatedOn);
    const notificationId = bundlingTarget?.id || this.createNotificationRecordId(issue, currentState.updatedOn);
    const existingNotification = bundlingTarget
      || this.notifications.get(notificationId)
      || this.findLatestNotificationForIssue(issue.id)
      || {};
    const changeSummary = existingNotification.lastSeenState
      ? this.buildIssueChangeSummary(existingNotification.lastSeenState, currentState)
      : [];
    const syncedNotification = this.buildNotificationFromIssue(issue, {
      ...existingNotification,
      id: notificationId,
      isUpdated: false,
      bundleCount: bundlingTarget
        ? Math.max(existingNotification.bundleCount || 1, 1) + 1
        : 1,
      changeSummary: bundlingTarget
        ? this.mergeChangeSummary(existingNotification.changeSummary, changeSummary)
        : changeSummary,
      lastSeenState: currentState
    });

    this.notifications.set(notificationId, syncedNotification);
    const retainedHistory = await this.mergeNotificationHistory([syncedNotification], {
      readNotificationIds: this.settings.readNotifications
    });

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

  async getIssueActionContext(issueId, profileId, notificationId) {
    try {
      await this.assertNotificationOwnership(notificationId, profileId);
      const api = await this.createApiClient();
      const context = await api.getIssueActionContext(issueId);

      return {
        success: true,
        context: this.formatIssueActionContext(context)
      };
    } catch (error) {
      return {
        success: false,
        error: this.resolveIssueActionError(error),
        status: error.code === 'outcomeUnknown' ? 'outcomeUnknown' : 'failure',
        requiresRefetch: error.code === 'outcomeUnknown'
      };
    }
  }

  async executeIssueAction(issueId, profileId, notificationId, actionCallback) {
    try {
      await this.assertNotificationOwnership(notificationId, profileId);
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
        error: this.resolveIssueActionError(error),
        status: error.code === 'outcomeUnknown' ? 'outcomeUnknown' : 'failure',
        requiresRefetch: error.code === 'outcomeUnknown'
      };
    }
  }

  async applyIssueChanges(issueId, changes, profileId, notificationId) {
    return this.executeIssueAction(issueId, profileId, notificationId, api => api.applyIssueChanges(issueId, changes));
  }

  createSyncResult(status, details = {}) {
    return {
      status,
      success: status === 'success',
      stale: details.stale === true,
      startedAt: details.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      lastSuccessAt: details.lastSuccessAt || null,
      errorCode: details.errorCode || null,
      retry: details.retry || null,
      trigger: details.trigger || 'unknown'
    };
  }

  requestSync(trigger = 'unknown', { force = false } = {}) {
    if (this.checkPromise) return this.checkPromise;
    const startedAt = new Date().toISOString();
    this.checkPromise = (async () => {
      if (force && this.activeProfile && this.profileState) {
        await this.profileState.write(this.activeProfile.profileId, 'seenIds', []);
      }
      return this.checkNotifications({ trigger, startedAt });
    })().finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  async scheduleRetry(error) {
    const retryCount = Math.min(Number(error.retryCount) || 1, MAX_REQUEST_RETRIES);
    const retryAfterSeconds = Math.min(Number(error.retryAfterSeconds) || 60, 300);
    if (retryCount > MAX_REQUEST_RETRIES) throw new Error('rateLimitRetryExceeded');
    const nextAttemptAt = Date.now() + retryAfterSeconds * 1000;
    const metadata = { retryCount, nextAttemptAt, profileId: this.activeProfile?.profileId || null };
    await chrome.storage.local.set({ [RETRY_METADATA_KEY]: metadata });
    chrome.alarms.create(RETRY_ALARM_NAME, { when: nextAttemptAt });
    return metadata;
  }

  async clearRetryMetadata() {
    await chrome.storage.local.remove([RETRY_METADATA_KEY]);
    await new Promise(resolve => chrome.alarms.clear(RETRY_ALARM_NAME, () => resolve()));
  }

  async checkNotifications({ trigger = 'direct', startedAt = new Date().toISOString() } = {}) {
    await this.ensureSettingsLoaded();

    if (!this.settings.redmineUrl || !this.settings.apiKey) {
      console.log('Redmine settings not configured');
      return this.createSyncResult('failure', { trigger, startedAt, errorCode: 'missingRequiredSettings' });
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
      await this.resolveActiveProfile(api);
      const retryState = await chrome.storage.local.get([RETRY_METADATA_KEY]);
      const retryMetadata = retryState?.[RETRY_METADATA_KEY];
      if (retryMetadata && retryMetadata.profileId === (this.activeProfile?.profileId || null)) {
        api.defaultRetryCount = Math.min(Number(retryMetadata.retryCount) || 0, MAX_REQUEST_RETRIES);
      }
      
      // Load last sync time from storage
      const cursor = this.profileState
        ? await this.profileState.read(this.activeProfile.profileId, 'cursor', null)
        : (await chrome.storage.local.get(['lastSyncTime'])).lastSyncTime;
      const cursorState = cursor && typeof cursor === 'object'
        ? cursor
        : { watermark: cursor || null, eventIds: [], reconciliationQueue: [], lastFullReconciliationAt: null };
      if (cursorState.watermark) api.lastSyncTime = new Date(cursorState.watermark);
      
      const response = await api.getIssuesLossless({
        onlyMyProjects: this.settings.onlyMyProjects,
        includeWatchedIssues: this.settings.includeWatchedIssues,
        cursor: cursorState.watermark
      });
      
      // Update last sync time
      const currentSyncTime = new Date();
      api.lastSyncTime = currentSyncTime;
      
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
      const previousIssueStates = this.profileState
        ? await this.profileState.read(this.activeProfile.profileId, 'issueStates', {})
        : this.normalizeStorageResult(await chrome.storage.local.get(['issueStates'])).issueStates || {};
      const existingHistory = await this.loadNotificationHistory();
      const existingHistoryById = new Map(existingHistory.map(record => [record.id, record]));
      this.notifications = new Map(existingHistory.map(record => [record.id, record]));

      console.log('Previous issue states count:', Object.keys(previousIssueStates).length);
      console.log('Current issues count:', issues.length);

      const currentIssueIds = new Set(issues.map(issue => String(issue.id)));
      const trackedIds = Object.keys(previousIssueStates);
      const dueForFullReconciliation = Boolean(cursorState.watermark) && (
        !cursorState.lastFullReconciliationAt
        || Date.now() - new Date(cursorState.lastFullReconciliationAt).getTime() >= FULL_RECONCILIATION_INTERVAL_MS
      );
      const missingIds = Array.from(new Set([
        ...(Array.isArray(cursorState.reconciliationQueue) ? cursorState.reconciliationQueue : []),
        ...trackedIds.filter(issueId => dueForFullReconciliation || !currentIssueIds.has(String(issueId)))
      ]));
      const reconciliationResults = missingIds.length ? await api.reconcileIssueIds(missingIds) : [];
      reconciliationResults.forEach(result => {
        if (result.unavailable) {
          const previous = previousIssueStates[result.id] || {};
          previousIssueStates[result.id] = {
            ...previous,
            unavailable: true,
            unavailableCode: result.errorCode,
            unavailableAt: previous.unavailableAt || Date.now()
          };
        } else {
          const eventKey = `${result.id}:${new Date(result.updated_on).toISOString()}`;
          if (!issues.some(issue => `${issue.id}:${new Date(issue.updated_on).toISOString()}` === eventKey)) issues.push(result);
        }
      });

      // Create a copy of readNotifications to avoid modifying the original during iteration
      const readNotificationsCopy = [...this.settings.readNotifications];
      const updatedReadNotifications = [...this.settings.readNotifications];
      
      for (const issue of issues) {
        const currentUpdateTime = new Date(issue.updated_on).getTime();
        const previousState = previousIssueStates[issue.id];
        const currentState = this.buildIssueSnapshot(issue);
        const changeSummary = this.buildIssueChangeSummary(previousState, currentState);
        const bundlingTarget = this.findBundlingTarget(issue.id, currentUpdateTime);
        const notificationId = bundlingTarget?.id || this.createNotificationRecordId(issue, currentUpdateTime);
        const existingRecord = bundlingTarget
          || existingHistoryById.get(notificationId)
          || this.notifications.get(notificationId)
          || {};
        const isRead = readNotificationsCopy.includes(notificationId) || existingRecord.read === true;

        // Check if this is a new issue or an updated issue
        if (!previousState) {
          // New issue
          console.log(`New issue detected: ${issue.id}`);
          const candidate = this.evaluateNotificationCandidate(issue, previousState, currentState);

          if (candidate.retain) {
            const notification = this.buildNotificationFromIssue(issue, {
              ...existingRecord,
              id: notificationId,
              read: isRead,
              isUpdated: false,
              bundleCount: Number.isSafeInteger(existingRecord.bundleCount) && existingRecord.bundleCount > 0
                ? existingRecord.bundleCount
                : 1,
              sourceType: issue.sourceType || existingRecord.sourceType || 'unknown',
              changeSummary: [],
              lastSeenState: currentState
            });
            this.notifications.set(notificationId, notification);

            const hasSeenBefore = await this.hasSeenNotification(notificationId);
            if (!isRead && !hasSeenBefore && candidate.deliver) {
              newNotifications.push(notification);
            }
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
            const candidate = this.evaluateNotificationCandidate(issue, previousState, currentState);

            if (candidate.retain) {
              const isBundledUpdate = bundlingTarget?.id === notificationId;
              const notification = this.buildNotificationFromIssue(issue, {
                ...existingRecord,
                id: notificationId,
                read: isRead,
                isUpdated: true,
                bundleCount: isBundledUpdate
                  ? Math.max(existingRecord.bundleCount || 1, 1) + 1
                  : 1,
                sourceType: issue.sourceType || existingRecord.sourceType || 'unknown',
                changeSummary: isBundledUpdate
                  ? this.mergeChangeSummary(existingRecord.changeSummary, changeSummary)
                  : changeSummary,
                lastSeenState: currentState
              });

              // If the issue was previously read but now updated, show notification again
              if (isRead) {
                // Remove from read notifications to make it appear as unread
                const readIndex = updatedReadNotifications.indexOf(notificationId);
                if (readIndex > -1) {
                  updatedReadNotifications.splice(readIndex, 1);
                  notification.read = false;
                }
              }

              this.notifications.set(notificationId, notification);

              if (candidate.deliver) {
                updatedNotifications.push(notification);
              }
            }
          }
        }

        // Update the issue state in storage
        previousIssueStates[issue.id] = currentState;
      }
      
      // Update read notifications in storage only once after processing all issues
      if (updatedReadNotifications.length !== this.settings.readNotifications.length) {
        this.settings.readNotifications = updatedReadNotifications;
        if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'readIds', updatedReadNotifications);
        else await chrome.storage.sync.set({ readNotifications: updatedReadNotifications });
      }

      const retainedIssueStates = Object.fromEntries(Object.entries(previousIssueStates)
        .sort(([, left], [, right]) => Number(right.updatedOn || 0) - Number(left.updatedOn || 0))
        .slice(0, MAX_ISSUE_STATES));
      if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'issueStates', retainedIssueStates);
      else await chrome.storage.local.set({ issueStates: retainedIssueStates });

      await this.mergeNotificationHistory(
        Array.from(this.notifications.values()),
        { readNotificationIds: updatedReadNotifications }
      );

      console.log('New notifications:', newNotifications.length);
      console.log('Updated notifications:', updatedNotifications.length);

      // Update badge
      const unreadCount = Array.from(this.notifications.values()).filter(n => !n.read).length;
      this.updateBadge(unreadCount);

      // Store seen notifications
      const seenNotifications = Array.from(this.notifications.keys());
      if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'seenIds', seenNotifications);
      else await chrome.storage.local.set({ seenNotifications });

      const processedReconciliationIds = new Set(reconciliationResults.map(issue => String(issue.id)));
      const nextCursor = {
        version: 1,
        watermark: currentSyncTime.toISOString(),
        eventIds: issues.filter(issue => issue.updated_on).map(issue =>
          `${this.activeProfile?.profileId || 'legacy'}:${issue.id}:${new Date(issue.updated_on).toISOString()}`).slice(-5000),
        reconciliationQueue: missingIds.filter(id => !processedReconciliationIds.has(String(id))),
        lastFullReconciliationAt: dueForFullReconciliation
          ? currentSyncTime.toISOString()
          : cursorState.lastFullReconciliationAt
      };
      const successfulAt = Date.now();
      if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'syncHealth', {
        version: 1, lastSuccessAt: successfulAt, lastErrorCode: null, lastErrorAt: null,
        stale: false, retry: null
      });
      else await chrome.storage.local.set({ lastError: null, lastErrorCode: null, lastErrorTime: null, lastSuccessAt: successfulAt });
      // Commit watermark last; any earlier storage failure preserves the previous cursor.
      if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'cursor', nextCursor);
      else await chrome.storage.local.set({ lastSyncTime: nextCursor.watermark });

      if (newNotifications.length > 0 && this.settings.enableNotifications) await this.showDesktopNotification(newNotifications, 'new');
      if (updatedNotifications.length > 0 && this.settings.enableNotifications) await this.showDesktopNotification(updatedNotifications, 'updated');

      console.log('Notification check completed. Unread count:', unreadCount);
      await this.clearRetryMetadata();
      return this.createSyncResult('success', {
        trigger, startedAt, lastSuccessAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('Failed to check notifications:', error);
      
      // Handle specific error types
      let errorMessage = this.resolveErrorMessage(error.message);
      let errorCode = null;
      let shouldRetry = true;
      if (error.message === 'rateLimitRetryScheduled') {
        const retry = await this.scheduleRetry(error);
        return this.createSyncResult('retryScheduled', {
          trigger, startedAt, stale: (await this.loadNotificationHistory()).length > 0,
          errorCode: 'rateLimited', retry
        });
      }
      
      if (error.message.includes('422')) {
        errorMessage = 'Invalid API parameters - check your Redmine configuration';
        shouldRetry = false; // Don't retry 422 errors immediately
        
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
      } else if (error.message === 'rateLimitRetryExceeded') {
        errorMessage = 'Rate limit retry limit reached';
        errorCode = 'rateLimitRetryExceeded';
        shouldRetry = false;
        
      } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Network error - check your internet connection';
      } else if (error.message === 'hostPermissionRequired') {
        errorMessage = this.translate('hostPermissionRequired');
        shouldRetry = false;
        errorCode = 'hostPermissionRequired';
        await this.syncHostPermissionRecoveryState({ notify: true });
      }
      
      // Store error information for debugging
      if (this.activeProfile && this.profileState) {
        const previousHealth = await this.profileState.read(this.activeProfile.profileId, 'syncHealth', {});
        await this.profileState.write(this.activeProfile.profileId, 'syncHealth', {
          version: 1,
          lastSuccessAt: previousHealth.lastSuccessAt || null,
          lastErrorCode: errorCode || 'syncFailed',
          lastErrorAt: Date.now(),
          shouldRetry,
          stale: true,
          retry: null
        });
      } else {
        await chrome.storage.local.set({ lastError: errorMessage, lastErrorCode: errorCode, lastErrorTime: Date.now(), shouldRetry });
      }
      
      // Update badge to show error state
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
      chrome.action.setTitle({ title: `Error: ${errorMessage}` });
      
      console.log(`Error handling completed. Should retry: ${shouldRetry}`);
      if (!shouldRetry) await this.clearRetryMetadata();
      const stale = (await this.loadNotificationHistory()).length > 0;
      return this.createSyncResult(stale ? 'stale' : 'failure', {
        trigger, startedAt, stale, errorCode: error.code || errorCode || 'syncFailed'
      });
    }
  }

  async hasSeenNotification(notificationId) {
    if (this.activeProfile && this.profileState) {
      const seen = await this.profileState.read(this.activeProfile.profileId, 'seenIds', []);
      return seen.includes(notificationId);
    }
    const result = this.normalizeStorageResult(
      await chrome.storage.local.get(['seenNotifications'])
    );
    const seenNotifications = result.seenNotifications || [];
    return seenNotifications.includes(notificationId);
  }

  async loadDesktopMappings() {
    if (!this.activeProfile || !this.profileState) return [];
    const mappings = await this.profileState.read(this.activeProfile.profileId, 'desktopMappings', []);
    const now = Date.now();
    const retained = (Array.isArray(mappings) ? mappings : [])
      .filter(mapping => mapping?.expiresAt > now && mapping.profileId === this.activeProfile.profileId)
      .slice(-MAX_DESKTOP_MAPPINGS);
    if (retained.length !== mappings.length) await this.profileState.write(this.activeProfile.profileId, 'desktopMappings', retained);
    return retained;
  }

  async createDesktopMapping(notification, mappingType) {
    if (!this.activeProfile || !this.profileState) return null;
    const mappings = await this.loadDesktopMappings();
    const token = this.profileState.createBindingId().replace(/-/g, '');
    const desktopId = `${mappingType === 'single' ? 'issue' : 'batch'}:${token}`;
    const mapping = {
      desktopId,
      profileId: this.activeProfile.profileId,
      recordId: mappingType === 'single' ? notification.id : null,
      issueUrl: mappingType === 'single' ? notification.url : null,
      type: mappingType,
      createdAt: Date.now(),
      expiresAt: Date.now() + DESKTOP_MAPPING_TTL_MS
    };
    await this.profileState.write(this.activeProfile.profileId, 'desktopMappings', [...mappings, mapping].slice(-MAX_DESKTOP_MAPPINGS));
    return mapping;
  }

  async removeDesktopMapping(desktopId) {
    if (!this.activeProfile || !this.profileState) return;
    const mappings = await this.loadDesktopMappings();
    await this.profileState.write(this.activeProfile.profileId, 'desktopMappings', mappings.filter(mapping => mapping.desktopId !== desktopId));
  }

  async resolveDesktopMapping(desktopId) {
    if (!this.activeProfile) await this.restoreActiveProfile();
    if (!this.activeProfile || !this.profileState) return null;
    const mapping = (await this.loadDesktopMappings()).find(item => item.desktopId === desktopId);
    if (!mapping || mapping.profileId !== this.activeProfile.profileId || mapping.expiresAt <= Date.now()) return null;
    if (mapping.type === 'single') {
      const record = (await this.loadNotificationHistory()).find(item => item.id === mapping.recordId);
      if (!record || record.profileId !== mapping.profileId || record.url !== mapping.issueUrl) return null;
      try {
        const base = new URL(this.settings.redmineUrl);
        const target = new URL(mapping.issueUrl);
        const normalizedBasePath = base.pathname.replace(/\/$/, '');
        if (base.origin !== target.origin || !target.pathname.startsWith(`${normalizedBasePath}/issues/`)) return null;
      } catch {
        return null;
      }
    }
    return mapping;
  }

  async handleDesktopClick(desktopId) {
    const mapping = await this.resolveDesktopMapping(desktopId);
    if (!mapping) {
      if (!desktopId.startsWith('issue:')) chrome.action.openPopup();
      return false;
    }
    if (mapping.type === 'batch') chrome.action.openPopup();
    else await chrome.tabs.create({ url: mapping.issueUrl });
    return true;
  }

  async handleDesktopButton(desktopId, buttonIndex) {
    const mapping = await this.resolveDesktopMapping(desktopId);
    if (!mapping || mapping.type !== 'single') return false;
    if (buttonIndex === 0) {
      await chrome.tabs.create({ url: mapping.issueUrl });
      return true;
    }
    if (buttonIndex === 1) {
      try {
        await this.markAsRead(mapping.recordId, mapping.profileId);
        await new Promise(resolve => chrome.notifications.clear(desktopId, () => resolve()));
        await this.removeDesktopMapping(desktopId);
        return true;
      } catch (_error) {
        const health = await this.profileState.read(this.activeProfile.profileId, 'syncHealth', {});
        await this.profileState.write(this.activeProfile.profileId, 'syncHealth', {
          ...health, lastErrorCode: 'desktopMarkReadFailed', lastErrorAt: Date.now()
        });
        return false;
      }
    }
    return false;
  }

  async showDesktopNotification(notifications, type = 'new') {
    console.log(`Attempting to show ${type} notification for ${notifications.length} items`);
    
    if (notifications.length === 1) {
      const notification = notifications[0];
      const isUpdate = type === 'updated';
      const mapping = await this.createDesktopMapping(notification, 'single');
      
      const notificationOptions = {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: isUpdate ? this.translate('issueUpdatedTitle') : this.translate('newIssueTitle'),
        message: notification.title,
        contextMessage: `${notification.project}${isUpdate ? ' (' + this.translate('updated') + ')' : ''}`,
        silent: !this.settings.enableSound,
        buttons: [
          { title: this.translate('openIssue') },
          { title: this.translate('markAsRead') }
        ]
      };

      const desktopId = mapping?.desktopId || `legacy:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      chrome.notifications.create(desktopId, notificationOptions, (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to create notification:', chrome.runtime.lastError);
        } else {
          console.log('Notification created successfully:', notificationId);
        }
      });
    } else {
      const isUpdate = type === 'updated';
      const count = notifications.length;
      const mapping = await this.createDesktopMapping(notifications[0], 'batch');
      const notificationOptions = {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: isUpdate ? this.translate('issuesUpdatedTitle') : this.translate('newIssuesTitle'),
        message: this.translate(isUpdate ? 'multipleIssuesUpdatedMessage' : 'multipleNewIssuesMessage', [count]),
        contextMessage: this.translate('clickToViewAll'),
        silent: !this.settings.enableSound
      };
      
      // ...已移除除錯用 log...
      
      const desktopId = mapping?.desktopId || `legacy:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      chrome.notifications.create(desktopId, notificationOptions, (notificationId) => {
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

  async markAsRead(notificationId, profileId) {
    await this.requireProfile(profileId);
    const notification = this.notifications.get(notificationId);
    if (notification && notification.profileId !== this.activeProfile?.profileId) throw new Error('profileMismatch');
    if (notification) {
      notification.read = true;
    }

    const readNotifications = this.profileState
      ? await this.profileState.read(this.activeProfile.profileId, 'readIds', [])
      : this.normalizeStorageResult(await chrome.storage.sync.get(['readNotifications'])).readNotifications || [];
    
    if (!readNotifications.includes(notificationId)) {
      readNotifications.push(notificationId);
      this.trimReadNotifications(readNotifications);
      if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'readIds', readNotifications);
      else await chrome.storage.sync.set({ readNotifications });
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
    await this.requireProfile();
    const history = await this.loadNotificationHistory();
    const unreadNotifications = Array.from(this.notifications.values()).filter(n => !n.read);
    const readNotifications = this.profileState
      ? await this.profileState.read(this.activeProfile.profileId, 'readIds', [])
      : this.normalizeStorageResult(await chrome.storage.sync.get(['readNotifications'])).readNotifications || [];

    for (const notification of unreadNotifications) {
      notification.read = true;
      if (!readNotifications.includes(notification.id)) {
        readNotifications.push(notification.id);
        this.trimReadNotifications(readNotifications);
      }
    }

    const updatedHistory = history.map(record => {
      if (!readNotifications.includes(record.id)) {
        readNotifications.push(record.id);
        this.trimReadNotifications(readNotifications);
      }

      return { ...record, read: true };
    });

    if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'readIds', readNotifications);
    else await chrome.storage.sync.set({ readNotifications });
    await this.saveNotificationHistory(updatedHistory);
    this.updateBadge(0);
  }

  async clearNotificationHistory() {
    await this.requireProfile();
    this.notifications.clear();
    if (this.profileState) {
      await Promise.all([
        this.profileState.write(this.activeProfile.profileId, 'readIds', []),
        this.profileState.write(this.activeProfile.profileId, 'history', []),
        this.profileState.write(this.activeProfile.profileId, 'seenIds', []),
        this.profileState.write(this.activeProfile.profileId, 'issueStates', {})
      ]);
    } else {
      await chrome.storage.sync.set({ readNotifications: [] });
      await chrome.storage.local.set({ [this.notificationHistoryStorageKey]: [], seenNotifications: [], issueStates: {} });
    }
    this.updateBadge(0);

    chrome.notifications.getAll((notifications) => {
      Object.keys(notifications).forEach(notificationId => {
        chrome.notifications.clear(notificationId);
      });
    });
  }

  trimReadNotifications(readNotifications) {
    if (readNotifications.length > MAX_READ_NOTIFICATIONS) {
      readNotifications.splice(0, readNotifications.length - MAX_READ_NOTIFICATIONS);
    }
  }

  async forceRefreshNotifications() {
    return this.requestSync('forceRefresh', { force: true });
  }

  async getNotifications() {
    await this.ensureSettingsLoaded();
    if (!this.activeProfile) await this.restoreActiveProfile();
    if (!this.activeProfile && this.settings.redmineUrl && this.settings.apiKey) await this.resolveActiveProfile();
    const history = await this.loadNotificationHistory();
    if (history.length > 0) {
      return history;
    }

    return Array.from(this.notifications.values()).sort((a, b) => b.updatedOn - a.updatedOn);
  }

  async getCachedNotifications() {
    await this.ensureSettingsLoaded();
    if (!this.activeProfile) await this.restoreActiveProfile();
    if (!this.activeProfile) return { notifications: [], syncHealth: null };
    const [notifications, syncHealth] = await Promise.all([
      this.loadNotificationHistory(),
      this.profileState.read(this.activeProfile.profileId, 'syncHealth', null)
    ]);
    return { notifications, syncHealth };
  }
}

// Background script logic
const notificationManager = new NotificationManager();
const ALARM_NAME = 'redmine-notification-check';

async function ensurePeriodicAlarm() {
  await notificationManager.loadSettings({ notifyPermissionRecovery: true });
  const intervalMinutes = notificationManager.settings.checkInterval || 15;
  const currentAlarm = await new Promise(resolve => chrome.alarms.get(ALARM_NAME, resolve));
  if (currentAlarm && Number(currentAlarm.periodInMinutes) === Number(intervalMinutes)) {
    return { changed: false, alarm: currentAlarm };
  }

  if (currentAlarm) {
    await new Promise(resolve => chrome.alarms.clear(ALARM_NAME, () => resolve()));
  }
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalMinutes });
  return { changed: true, periodInMinutes: intervalMinutes };
}

// Extension event listeners
chrome.runtime.onInstalled.addListener(() => {
  console.log('MewMewNotification extension installed');
  ensurePeriodicAlarm()
    .then(() => notificationManager.requestSync('installed'))
    .catch(error => console.error('Install synchronization failed:', error));
});

chrome.runtime.onStartup.addListener(() => {
  console.log('MewMewNotification extension started');
  ensurePeriodicAlarm()
    .then(() => notificationManager.requestSync('startup'))
    .catch(error => console.error('Startup synchronization failed:', error));
});

// Alarm listener for periodic checks
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Alarm triggered: periodic notification check');
    notificationManager.requestSync('alarm');
  } else if (alarm.name === RETRY_ALARM_NAME) {
    notificationManager.requestSync('retryAlarm');
  }
});

// Storage change listener to update settings and language
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    console.log('Storage changes detected:', Object.keys(changes));
    
    // Reload settings if any setting changed
    if (Object.keys(changes).some(key => [
      'redmineUrl',
      'checkInterval',
      'enableNotifications',
      'enableSound',
      'maxNotifications',
      'onlyMyProjects',
      'includeWatchedIssues',
      'readNotifications',
      'notificationProjectRules',
      'notificationChangeFilters',
      'notificationQuietHours',
      'notificationBundling'
    ].includes(key))) {
      console.log('Settings changed, reloading...');
      notificationManager.loadSettings().then(() => {
        if (changes.redmineUrl) notificationManager.clearRetryMetadata();
        // Restart periodic check if check interval changed
        if (changes.checkInterval) {
          console.log('Check interval changed, restarting periodic check');
          ensurePeriodicAlarm();
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
    const oldKey = changes.apiKey.oldValue;
    const newKey = changes.apiKey.newValue;
    const rotateBinding = notificationManager.profileState && oldKey !== newKey
      ? notificationManager.profileState.rotateCredentialBinding(newKey)
      : Promise.resolve();
    rotateBinding.then(() => {
      notificationManager.activeProfile = null;
      return notificationManager.clearRetryMetadata();
    }).then(() => {
      return notificationManager.loadSettings();
    }).catch(error => console.error('Failed to rotate credential binding:', error));
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

    case 'getCachedNotifications':
      return handleAsyncResponse(() => notificationManager.getCachedNotifications());
      
    case 'markAsRead':
      return handleAsyncResponse(async () => {
        await notificationManager.markAsRead(request.notificationId, request.profileId);
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
        const syncResult = await notificationManager.requestSync('popup');
        return { ...syncResult, notifications: await notificationManager.getNotifications() };
      });
      
    case 'forceRefreshNotifications':
      return handleAsyncResponse(async () => {
        const syncResult = await notificationManager.forceRefreshNotifications();
        return { ...syncResult, notifications: await notificationManager.getNotifications() };
      });
      
    case 'clearNotificationHistory':
      return handleAsyncResponse(async () => {
        await notificationManager.clearNotificationHistory();
        return { success: true };
      });

    case 'getIssueActionContext':
      return handleAsyncResponse(
        () => notificationManager.getIssueActionContext(request.issueId, request.profileId, request.notificationId),
        error => notificationManager.resolveIssueActionError(error)
      );

    case 'applyIssueChanges':
      return handleAsyncResponse(
        () => notificationManager.applyIssueChanges(request.issueId, request.changes, request.profileId, request.notificationId),
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

    case 'getNotificationProjects':
      return handleAsyncResponse(async () => {
        const result = await notificationManager.getNotificationProjects({
          forceRefresh: request.forceRefresh === true
        });
        return {
          success: true,
          ...result
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

  notificationManager.handleDesktopClick(notificationId)
    .catch(error => console.error('Desktop notification click failed:', error));
});

chrome.notifications.onButtonClicked?.addListener((notificationId, buttonIndex) => {
  notificationManager.handleDesktopButton(notificationId, buttonIndex)
    .catch(error => console.error('Desktop notification button failed:', error));
});

chrome.notifications.onClosed?.addListener(notificationId => {
  notificationManager.removeDesktopMapping(notificationId)
    .catch(error => console.error('Desktop notification cleanup failed:', error));
});

// Module load only repairs the periodic alarm; it never starts synchronization.
ensurePeriodicAlarm().catch(error => console.error('Failed to ensure periodic alarm:', error));
