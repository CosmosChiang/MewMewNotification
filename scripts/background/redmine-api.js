(function initializeRedmineApi(root, factory) {
  const exports = factory();
  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else Object.assign(root, exports);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRedmineApiExports() {
  const MAX_CACHE_SIZE = 100;
  const MAX_REQUEST_RETRIES = 3;
  const REQUEST_TIMEOUT_MS = 30000;
  const WORKER_SAFE_RETRY_SECONDS = 5;
  const API_PAGE_SIZE = 100;
  const CURSOR_OVERLAP_MS = 2 * 60 * 1000;
  const RECONCILIATION_BUDGET = 20;
  const DefaultConfigManagerClass = globalThis.ConfigManager
    || (typeof require === 'function' ? require('../shared/config-manager.js').ConfigManager : undefined);

  class RedmineAPI {
    constructor(baseUrl, apiKey, {
      fetch: fetchImplementation = globalThis.fetch,
      AbortController: AbortControllerClass = globalThis.AbortController,
      setTimeout: setTimeoutImplementation = globalThis.setTimeout,
      clearTimeout: clearTimeoutImplementation = globalThis.clearTimeout,
      now = Date.now,
      ConfigManagerClass = DefaultConfigManagerClass,
      logger
    } = {}) {
      this.fetch = fetchImplementation;
      this.AbortController = AbortControllerClass;
      this.setTimeout = setTimeoutImplementation;
      this.clearTimeout = clearTimeoutImplementation;
      this.now = now;
      this.ConfigManagerClass = ConfigManagerClass;
      this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
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
          this.logger.debug(`Cache hit for: ${endpoint}`);
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
      if (expiry && this.now() < expiry) {
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
      this.cacheExpiry.set(key, this.now() + ttl);
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
        const now = this.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
          await new Promise(resolve => this.setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
        }

        try {
          const result = await this.makeRequest(endpoint, options);
          this.lastRequestTime = this.now();

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

      const controller = new this.AbortController();
      const timeoutId = this.setTimeout(() => controller.abort('connectionTimeout'), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetch(url, {
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
          this.logger.warn(`Rate limited. Waiting ${retryAfter} seconds before retry.`);
          await new Promise(resolve => this.setTimeout(resolve, retryAfter * 1000));
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
            this.logger.error('Redmine API returned 422 - Unprocessable Content. This usually means invalid parameters.');
            this.logger.error('Request URL:', response.url);
            this.logger.error('Response body:', errorBody);

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
        this.logger.error('Redmine API request failed:', error);

        // Handle specific error types
        if (error.name === 'AbortError' || controller.signal.aborted) {
          const timeoutError = new Error('connectionTimeout');
          timeoutError.code = options.method && options.method !== 'GET' ? 'outcomeUnknown' : 'connectionTimeout';
          throw timeoutError;
        }

        // Handle network errors with retry logic
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          this.logger.warn('Network error, will retry on next check cycle');
        }

        throw error;
      } finally {
        this.clearTimeout(timeoutId);
      }
    }

    async getCurrentUser() {
      if (!this.currentUser) {
        try {
          const response = await this.request('/users/current.json');
          this.currentUser = response.user;
          this.logger.debug('Current user loaded:', { id: this.currentUser.id });

          // Try to detect Redmine version from response headers or other means
          // This helps us adapt API parameters for different Redmine versions
          if (response.redmine_version) {
            this.redmineVersion = response.redmine_version;
            this.logger.debug('Detected Redmine version:', this.redmineVersion);
          }
        } catch (error) {
          this.logger.error('Failed to get current user:', error);
          throw error;
        }
      }
      return this.currentUser;
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
      const configManagerClass = this.ConfigManagerClass;
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
              this.logger.warn(`Invalid updated_on format: ${value}, skipping`);
            }
            break;

          case 'assigned_to_id':
          case 'watcher_id':
            // Ensure IDs are numeric
            const numericId = parseInt(value);
            if (!isNaN(numericId) && numericId > 0) {
              validatedParams[key] = numericId;
            } else {
              this.logger.warn(`Invalid ${key}: ${value}, skipping`);
            }
            break;

          case 'status_id':
            // Allow 'open' or numeric values
            if (value === 'open' || (!isNaN(parseInt(value)) && parseInt(value) > 0)) {
              validatedParams[key] = value;
            } else {
              this.logger.warn(`Invalid status_id: ${value}, using 'open'`);
              validatedParams[key] = 'open';
            }
            break;

          case 'limit':
            // Ensure limit is reasonable
            const limit = parseInt(value);
            if (!isNaN(limit) && limit > 0 && limit <= 1000) {
              validatedParams[key] = limit;
            } else {
              this.logger.warn(`Invalid limit: ${value}, using 50`);
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

  return { RedmineAPI };
});
