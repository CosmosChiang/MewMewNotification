class PopupManager {
  constructor() {
    this.currentLanguage = 'en';
    this.translations = {};
    this.notifications = [];
    this.renderQueue = [];
    this.isRendering = false;
    this.expandedNotificationId = undefined;
    this.issueActionStates = new Map();
    this.virtualScrollConfig = {
      itemHeight: 80,
      bufferSize: 5,
      visibleItems: 10
    };
    this.init();
  }

  async init() {
    await this.loadLanguage();
    this.setupEventListeners();
    this.loadNotifications();
  }

  async loadLanguage(languageOverride) {
    try {
      if (languageOverride) {
        this.currentLanguage = languageOverride;
      } else {
        const result = await chrome.storage.sync.get(['language']);
        const configManagerClass = globalThis.ConfigManager;
        const languageSettings = configManagerClass?.normalizeStorageResult
          ? configManagerClass.normalizeStorageResult(result)
          : (result && typeof result === 'object' ? result : {});
        this.currentLanguage = languageSettings.language || 'en';
      }
      
      const response = await fetch(`_locales/${this.currentLanguage}/messages.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.translations = await response.json();
      
      this.updateUI();
      return this.translations;
    } catch (error) {
      console.error('Failed to load language:', error);
      if (this.currentLanguage !== 'en') {
        return this.loadLanguage('en');
      }
      this.translations = {};
      this.updateUI();
      return this.translations;
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
    const elements = {
      headerTitle: 'popupTitle',
      loadingText: 'loadingText',
      emptyText: 'noNotifications',
      errorText: 'loadError'
    };

    Object.entries(elements).forEach(([elementId, translationKey]) => {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = this.translate(translationKey);
      }
    });

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

  async sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const resolveOnce = (response) => {
        if (settled) {
          return;
        }
        settled = true;

        if (response === undefined) {
          reject(new Error('backgroundNoResponse'));
          return;
        }

        resolve(response);
      };

      const rejectOnce = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      try {
        const maybePromise = chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime?.lastError) {
            rejectOnce(new Error(chrome.runtime.lastError.message));
            return;
          }

          resolveOnce(response);
        });

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolveOnce).catch(rejectOnce);
        }
      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  resolveRuntimeError(error, fallbackKey = 'actionsUnavailable') {
    const errorMessage = error?.message || String(error);

    if (errorMessage === 'backgroundNoResponse') {
      return this.translate('backgroundNoResponse');
    }

    return errorMessage || this.translate(fallbackKey);
  }

  getNotificationTemplate() {
    if (!this._notificationTemplate) {
      this._notificationTemplate = document.createElement('div');
      this._notificationTemplate.innerHTML = `
        <div class="notification-content">
          <div class="notification-title"></div>
          <div class="notification-meta"></div>
        </div>
        <div class="notification-actions"></div>
        <div class="advanced-actions-panel" hidden></div>
      `;
    }
    return this._notificationTemplate;
  }

  throttledRender() {
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    this.renderTimeout = setTimeout(() => {
      this.renderNotifications();
    }, 16);
  }

  setupEventListeners() {
    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    document.getElementById('markAllReadBtn').addEventListener('click', () => {
      this.markAllAsRead();
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.refreshNotifications();
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
      this.clearAllNotifications();
    });

    document.getElementById('retryBtn').addEventListener('click', () => {
      this.loadNotifications();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.language) {
        this.loadLanguage();
      }
    });
  }

  async loadNotifications() {
    this.showLoading();
    
    try {
      const response = await this.sendRuntimeMessage({ action: 'refreshNotifications' });
      
      if (response.success) {
        this.notifications = response.notifications
          .filter(notification => !notification.read)
          .map(notification => this.normalizeNotification(notification));
        this.pruneIssueActionState();
        this.throttledRender();
      } else {
        this.showError(response.error);
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
      this.showError(this.resolveRuntimeError(error, 'loadError'));
    }
  }

  normalizeNotification(notification) {
    return {
      ...notification,
      updatedOn: notification.updatedOn ? new Date(notification.updatedOn) : new Date()
    };
  }

  pruneIssueActionState() {
    const activeNotificationIds = new Set(this.notifications.map(notification => notification.id));

    Array.from(this.issueActionStates.keys()).forEach(notificationId => {
      if (!activeNotificationIds.has(notificationId)) {
        this.issueActionStates.delete(notificationId);
      }
    });

    if (this.expandedNotificationId && !activeNotificationIds.has(this.expandedNotificationId)) {
      this.expandedNotificationId = undefined;
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
    
    if (this.notifications.length > 20 && !this.expandedNotificationId) {
      this.renderVirtualScrollNotifications(notificationsList);
    } else {
      this.renderAllNotifications(notificationsList);
    }

    const hasUnread = this.notifications.some(notification => !notification.read);
    const markAllBtn = document.getElementById('markAllReadBtn');
    markAllBtn.style.display = hasUnread ? 'flex' : 'none';
  }

  renderAllNotifications(container) {
    const fragment = document.createDocumentFragment();
    
    this.notifications.forEach(notification => {
      const notificationElement = this.createNotificationElement(notification);
      fragment.appendChild(notificationElement);
    });
    
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  renderVirtualScrollNotifications(container) {
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
    
    this.updateVirtualScrollView(container, viewportContainer, 0);
    
    let scrollTimeout;
    container.addEventListener('scroll', () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollTop = container.scrollTop;
        this.updateVirtualScrollView(container, viewportContainer, scrollTop);
      }, 16);
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
    
    const fragment = document.createDocumentFragment();
    
    for (let index = startIndex; index <= endIndex; index += 1) {
      const notification = this.notifications[index];
      const element = this.createNotificationElement(notification);
      element.style.position = 'absolute';
      element.style.top = `${index * itemHeight}px`;
      element.style.left = '0';
      element.style.right = '0';
      element.style.height = `${itemHeight}px`;
      fragment.appendChild(element);
    }
    
    viewportContainer.innerHTML = '';
    viewportContainer.appendChild(fragment);
  }

  createNotificationElement(notification) {
    const template = this.getNotificationTemplate();
    const element = template.cloneNode(true);
    
    element.className = `notification-item ${notification.read ? 'read' : ''} ${notification.isUpdated ? 'updated' : ''}`;
    if (this.expandedNotificationId === notification.id) {
      element.classList.add('expanded');
    }
    element.dataset.notificationId = this.sanitizeAttribute(notification.id);

    const formattedDate = this.formatDate(notification.updatedOn);
    
    const contentDiv = element.querySelector('.notification-content');
    const titleDiv = element.querySelector('.notification-title');
    const metaDiv = element.querySelector('.notification-meta');
    const actionsDiv = element.querySelector('.notification-actions');
    const advancedPanel = element.querySelector('.advanced-actions-panel');
    
    titleDiv.innerHTML = '';
    
    if (notification.isUpdated) {
      const updateIndicator = document.createElement('span');
      updateIndicator.className = 'update-indicator';
      updateIndicator.textContent = '🔄';
      titleDiv.appendChild(updateIndicator);
      titleDiv.appendChild(document.createTextNode(' '));
    }
    
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
    
    titleDiv.appendChild(document.createTextNode(notification.title || ''));
    
    metaDiv.innerHTML = '';
    const metaValues = [
      notification.project || '',
      notification.status || '',
      notification.assigneeName
        ? this.translate('assigneeMeta', [notification.assigneeName])
        : '',
      formattedDate
    ].filter(Boolean);

    metaValues.forEach(value => {
      const metaSpan = document.createElement('span');
      metaSpan.textContent = value;
      metaDiv.appendChild(metaSpan);
    });
    
    if (notification.isUpdated) {
      const updateText = document.createElement('span');
      updateText.className = 'update-text';
      updateText.textContent = this.translate('updated');
      metaDiv.appendChild(updateText);
    }
    
    actionsDiv.innerHTML = '';

    const moreActionsButton = document.createElement('button');
    moreActionsButton.className = 'more-actions-btn';
    moreActionsButton.title = this.expandedNotificationId === notification.id
      ? this.translate('hideActions')
      : this.translate('moreActions');
    moreActionsButton.textContent = '⋯';
    moreActionsButton.addEventListener('click', event => {
      event.stopPropagation();
      this.toggleAdvancedActions(notification.id);
    });
    actionsDiv.appendChild(moreActionsButton);
    
    if (!notification.read) {
      const markReadBtn = document.createElement('button');
      markReadBtn.className = 'mark-read-btn';
      markReadBtn.title = this.translate('markAsRead');
      markReadBtn.dataset.notificationId = this.sanitizeAttribute(notification.id);
      
      const buttonIcon = document.createElement('span');
      buttonIcon.textContent = '✓';
      markReadBtn.appendChild(buttonIcon);
      
      markReadBtn.addEventListener('click', event => {
        event.stopPropagation();
        this.markAsRead(notification.id);
      });
      
      actionsDiv.appendChild(markReadBtn);
    }

    if (this.expandedNotificationId === notification.id) {
      this.renderAdvancedActionsPanel(notification, advancedPanel);
    }
 
    contentDiv.addEventListener('click', () => {
      this.openNotification(notification);
    });
 
    return element;
  }

  getIssueActionState(notificationId) {
    if (!this.issueActionStates.has(notificationId)) {
      this.issueActionStates.set(notificationId, {
        isLoading: false,
        isSubmitting: false,
        error: '',
        success: '',
        context: undefined,
        replyText: '',
        statusId: '',
        assigneeId: ''
      });
    }

    return this.issueActionStates.get(notificationId);
  }

  findNotification(notificationId) {
    return this.notifications.find(notification => notification.id === notificationId);
  }

  syncIssueActionSelections(state) {
    const context = state.context;
    if (!context) {
      state.statusId = '';
      state.assigneeId = '';
      return;
    }

    const currentStatusId = context.current?.statusId;
    if (currentStatusId !== undefined) {
      state.statusId = String(currentStatusId);
    }

    const currentAssigneeId = context.current?.assigneeId;
    state.assigneeId = currentAssigneeId !== undefined ? String(currentAssigneeId) : '';
  }

  async toggleAdvancedActions(notificationId) {
    if (this.expandedNotificationId === notificationId) {
      this.expandedNotificationId = undefined;
      this.renderNotifications();
      return;
    }

    this.expandedNotificationId = notificationId;
    const state = this.getIssueActionState(notificationId);
    state.error = '';
    state.success = '';
    this.renderNotifications();

    if (!state.context && !state.isLoading) {
      await this.loadIssueActionContext(notificationId);
    }
  }

  async loadIssueActionContext(notificationId) {
    const notification = this.findNotification(notificationId);
    if (!notification) {
      return;
    }

    const state = this.getIssueActionState(notificationId);
    state.isLoading = true;
    state.error = '';
    state.success = '';
    this.renderNotifications();

    try {
      const response = await this.sendRuntimeMessage({
        action: 'getIssueActionContext',
        issueId: notification.issueId
      });

      if (!response?.success) {
        throw new Error(response?.error || this.translate('actionsUnavailable'));
      }

      state.context = response.context;
      this.syncIssueActionSelections(state);
    } catch (error) {
      console.error('Failed to load issue action context:', error);
      state.error = this.resolveRuntimeError(error);
    } finally {
      state.isLoading = false;
      this.renderNotifications();
    }
  }

  renderAdvancedActionsPanel(notification, panel) {
    const state = this.getIssueActionState(notification.id);
    panel.hidden = false;
    panel.innerHTML = '';

    if (state.error) {
      panel.appendChild(this.createMessageElement('action-message error', state.error));
    }

    if (state.success) {
      panel.appendChild(this.createMessageElement('action-message success', state.success));
    }

    if (state.isLoading) {
      panel.appendChild(this.createMessageElement('action-message info', this.translate('loadingActions')));
      return;
    }

    if (!state.context) {
      if (!state.error) {
        panel.appendChild(this.createMessageElement('action-message info', this.translate('actionsUnavailable')));
      }
      return;
    }

    let updateSubmitState = () => {};

    panel.appendChild(this.createReplySection(notification, state, () => updateSubmitState()));
    panel.appendChild(this.createStatusSection(notification, state, () => updateSubmitState()));
    panel.appendChild(this.createAssigneeSection(notification, state, () => updateSubmitState()));

    const submitSection = this.createCombinedSubmitSection(notification, state);
    updateSubmitState = submitSection.updateSubmitState;
    panel.appendChild(submitSection.element);
  }

  createMessageElement(className, message) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = message;
    return element;
  }

  createSectionHeader(titleText) {
    const header = document.createElement('h3');
    header.className = 'advanced-actions-title';
    header.textContent = titleText;
    return header;
  }

  createAdvancedActionControlId(notificationId, fieldName) {
    return `advanced-actions-${this.sanitizeAttribute(notificationId)}-${fieldName}`;
  }

  createFieldLabel(labelText, controlId) {
    const label = document.createElement('label');
    label.className = 'advanced-actions-label';
    label.textContent = labelText;
    if (controlId) {
      label.htmlFor = controlId;
    }
    return label;
  }

  createReplySection(notification, state, onStateChange = () => {}) {
    const section = document.createElement('section');
    section.className = 'advanced-actions-section';
    section.appendChild(this.createSectionHeader(this.translate('quickReply')));

    const textareaId = this.createAdvancedActionControlId(notification.id, 'reply');
    const textarea = document.createElement('textarea');
    textarea.id = textareaId;
    textarea.className = 'advanced-actions-textarea';
    textarea.placeholder = this.translate('replyPlaceholder');
    textarea.value = state.replyText;
    textarea.disabled = state.isSubmitting || !state.context.permissions.canReply;

    const previewLabel = this.createFieldLabel(this.translate('markdownPreview'));
    const preview = document.createElement('div');
    preview.className = 'markdown-preview';
    preview.innerHTML = this.renderMarkdown(state.replyText);

    textarea.addEventListener('click', event => event.stopPropagation());
    textarea.addEventListener('input', () => {
      state.replyText = textarea.value;
      preview.innerHTML = this.renderMarkdown(state.replyText);
      onStateChange();
    });

    const label = this.createFieldLabel(this.translate('replyLabel'), textareaId);
    section.appendChild(label);
    section.appendChild(textarea);
    section.appendChild(previewLabel);
    section.appendChild(preview);

    if (!state.context.permissions.canReply) {
      section.appendChild(this.createMessageElement('action-hint', this.translate('permissionDenied')));
    }

    return section;
  }

  createStatusSection(notification, state, onStateChange = () => {}) {
    const section = document.createElement('section');
    section.className = 'advanced-actions-section';
    section.appendChild(this.createSectionHeader(this.translate('changeStatus')));

    const selectId = this.createAdvancedActionControlId(notification.id, 'status');
    const label = this.createFieldLabel(this.translate('statusLabel'), selectId);
    const select = document.createElement('select');
    select.id = selectId;
    select.className = 'advanced-actions-select';
    select.disabled = state.isSubmitting || !state.context.permissions.canChangeStatus;

    state.context.statusOptions.forEach(option => {
      const optionElement = document.createElement('option');
      optionElement.value = String(option.id);
      optionElement.textContent = option.name;
      if (String(option.id) === state.statusId) {
        optionElement.selected = true;
      }
      select.appendChild(optionElement);
    });

    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', () => {
      state.statusId = select.value;
      onStateChange();
    });

    section.appendChild(label);
    section.appendChild(select);

    if (!state.context.permissions.canChangeStatus) {
      section.appendChild(this.createMessageElement('action-hint', this.translate('permissionDenied')));
    }

    return section;
  }

  createAssigneeSection(notification, state, onStateChange = () => {}) {
    const section = document.createElement('section');
    section.className = 'advanced-actions-section';
    section.appendChild(this.createSectionHeader(this.translate('changeAssignee')));

    const selectId = this.createAdvancedActionControlId(notification.id, 'assignee');
    const label = this.createFieldLabel(this.translate('assigneeLabel'), selectId);
    const select = document.createElement('select');
    select.id = selectId;
    select.className = 'advanced-actions-select';
    select.disabled = state.isSubmitting || !state.context.permissions.canChangeAssignee;

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = this.translate('selectAssignee');
    placeholderOption.selected = !state.assigneeId;
    select.appendChild(placeholderOption);

    state.context.assigneeOptions.forEach(option => {
      const optionElement = document.createElement('option');
      optionElement.value = String(option.id);
      optionElement.textContent = option.name;
      if (String(option.id) === state.assigneeId) {
        optionElement.selected = true;
      }
      select.appendChild(optionElement);
    });

    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', () => {
      state.assigneeId = select.value;
      onStateChange();
    });

    section.appendChild(label);
    section.appendChild(select);

    if (!state.context.permissions.canChangeAssignee) {
      section.appendChild(this.createMessageElement('action-hint', this.translate('permissionDenied')));
    }

    return section;
  }

  createCombinedSubmitSection(notification, state) {
    const section = document.createElement('section');
    section.className = 'advanced-actions-footer';

    const hint = document.createElement('p');
    hint.className = 'advanced-actions-submit-hint';
    hint.textContent = this.translate('submitChangesHint');

    const submitButton = document.createElement('button');
    submitButton.className = 'advanced-action-button primary combined-submit-button';
    submitButton.textContent = this.translate('submitChanges');

    const updateSubmitState = () => {
      submitButton.disabled = state.isSubmitting || !this.hasPendingIssueChanges(state);
    };

    submitButton.addEventListener('click', event => {
      event.stopPropagation();
      this.submitIssueChanges(notification.id);
    });

    updateSubmitState();
    section.appendChild(hint);
    section.appendChild(submitButton);

    return {
      element: section,
      updateSubmitState
    };
  }

  renderMarkdown(markdownText) {
    if (typeof markdownText !== 'string' || !markdownText.trim()) {
      return `<p class="markdown-preview-placeholder">${this.escapeHtml(this.translate('noPreview'))}</p>`;
    }

    const blocks = [];
    const lines = markdownText.split(/\r?\n/);
    let listType;
    let listItems = [];

    const flushList = () => {
      if (!listType || listItems.length === 0) {
        listType = undefined;
        listItems = [];
        return;
      }

      blocks.push(`<${listType}>${listItems.map(item => `<li>${item}</li>`).join('')}</${listType}>`);
      listType = undefined;
      listItems = [];
    };

    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        flushList();
        return;
      }

      const unorderedListMatch = /^[-*]\s+(.+)$/.exec(trimmedLine);
      if (unorderedListMatch) {
        if (listType && listType !== 'ul') {
          flushList();
        }
        listType = 'ul';
        listItems.push(this.renderInlineMarkdown(unorderedListMatch[1]));
        return;
      }

      const orderedListMatch = /^\d+\.\s+(.+)$/.exec(trimmedLine);
      if (orderedListMatch) {
        if (listType && listType !== 'ol') {
          flushList();
        }
        listType = 'ol';
        listItems.push(this.renderInlineMarkdown(orderedListMatch[1]));
        return;
      }

      flushList();
      blocks.push(`<p>${this.renderInlineMarkdown(trimmedLine)}</p>`);
    });

    flushList();
    return blocks.join('');
  }

  renderInlineMarkdown(text) {
    let renderedText = this.escapeHtml(text);

    renderedText = renderedText.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label, url) => {
        const safeUrl = this.sanitizeUrl(url);
        if (safeUrl === '#') {
          return label;
        }

        return `<a href="${this.escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    );
    renderedText = renderedText.replace(/`([^`]+)`/g, '<code>$1</code>');
    renderedText = renderedText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    renderedText = renderedText.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    return renderedText;
  }

  getPendingIssueChanges(state) {
    const pendingChanges = {};
    const trimmedReply = typeof state.replyText === 'string' ? state.replyText.trim() : '';

    if (trimmedReply) {
      pendingChanges.reply = trimmedReply;
    }

    if (
      state.context?.permissions?.canChangeStatus
      && state.statusId
      && String(state.context.current?.statusId) !== state.statusId
    ) {
      pendingChanges.statusId = Number.parseInt(state.statusId, 10);
    }

    if (
      state.context?.permissions?.canChangeAssignee
      && state.assigneeId
      && String(state.context.current?.assigneeId || '') !== state.assigneeId
    ) {
      pendingChanges.assigneeId = Number.parseInt(state.assigneeId, 10);
    }

    return pendingChanges;
  }

  hasPendingIssueChanges(state) {
    return Object.keys(this.getPendingIssueChanges(state)).length > 0;
  }

  async executeIssueAction(notificationId, message, successMessageKey) {
    const notification = this.findNotification(notificationId);
    if (!notification) {
      return;
    }

    const state = this.getIssueActionState(notificationId);
    state.isSubmitting = true;
    state.error = '';
    state.success = '';
    this.renderNotifications();

    try {
      const response = await this.sendRuntimeMessage(message);

      if (!response?.success) {
        throw new Error(response?.error || this.translate('actionsUnavailable'));
      }

      if (response.notification) {
        this.updateNotificationFromAction(response.notification);
      }

      if (response.context) {
        state.context = response.context;
        this.syncIssueActionSelections(state);
      }

      if (message.action === 'applyIssueChanges' && message.changes?.reply !== undefined) {
        state.replyText = '';
      }

      state.success = this.translate(successMessageKey);
    } catch (error) {
      console.error('Issue action failed:', error);
      state.error = this.resolveRuntimeError(error);
    } finally {
      state.isSubmitting = false;
      this.renderNotifications();
    }
  }

  updateNotificationFromAction(notification) {
    const normalizedNotification = this.normalizeNotification(notification);
    const existingNotification = this.findNotification(normalizedNotification.id);
    const mergedNotification = existingNotification
      ? { ...existingNotification, ...normalizedNotification }
      : normalizedNotification;

    const existingIndex = this.notifications.findIndex(item => item.id === mergedNotification.id);
    if (existingIndex >= 0) {
      this.notifications.splice(existingIndex, 1, mergedNotification);
    } else {
      this.notifications.push(mergedNotification);
    }

    this.notifications.sort((left, right) => right.updatedOn - left.updatedOn);
  }

  async submitIssueChanges(notificationId) {
    const state = this.getIssueActionState(notificationId);
    const notification = this.findNotification(notificationId);
    if (!notification) {
      return;
    }

    const changes = this.getPendingIssueChanges(state);
    if (Object.keys(changes).length === 0) {
      state.error = this.translate('noChangesToSubmit');
      this.renderNotifications();
      return;
    }

    await this.executeIssueAction(
      notificationId,
      {
        action: 'applyIssueChanges',
        issueId: notification.issueId,
        changes
      },
      'issueChangesSuccess'
    );
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
    return value.replace(/[<>"'&]/g, '');
  }

  sanitizeUrl(url) {
    if (typeof url !== 'string') {
      return '#';
    }
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        return url;
      }
    } catch (error) {
      console.warn('Invalid URL provided:', url);
    }
    return '#';
  }

  async openNotification(notification) {
    const safeUrl = this.sanitizeUrl(notification.url);
    if (safeUrl === '#') {
      console.error('Invalid or unsafe URL detected:', notification.url);
      return;
    }
    
    try {
      await chrome.tabs.create({ url: safeUrl });
      window.close();
    } catch (error) {
      console.error('Failed to open notification URL:', error);
    }
  }

  async markAsRead(notificationId) {
    try {
      const response = await this.sendRuntimeMessage({
        action: 'markAsRead',
        notificationId
      });
      
      if (response.success) {
        this.notifications = this.notifications.filter(notification => notification.id !== notificationId);
        this.issueActionStates.delete(notificationId);
        if (this.expandedNotificationId === notificationId) {
          this.expandedNotificationId = undefined;
        }
        this.renderNotifications();
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  async markAllAsRead() {
    try {
      const response = await this.sendRuntimeMessage({ action: 'markAllAsRead' });
      
      if (response.success) {
        this.notifications = [];
        this.issueActionStates.clear();
        this.expandedNotificationId = undefined;
        this.renderNotifications();
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  }

  async refreshNotifications() {
    const refreshBtn = document.getElementById('refreshBtn');
    const originalTransform = refreshBtn.style.transform;
    refreshBtn.style.transform = 'rotate(360deg)';
    refreshBtn.style.transition = 'transform 0.3s ease-in-out';
    refreshBtn.disabled = true;
    
    this.showLoading();
    
    setTimeout(() => {
      refreshBtn.style.transform = originalTransform;
      refreshBtn.disabled = false;
    }, 300);

    try {
      const response = await this.sendRuntimeMessage({ 
        action: 'forceRefreshNotifications' 
      });
      
      if (response.success) {
        this.notifications = response.notifications
          .filter(notification => !notification.read)
          .map(notification => this.normalizeNotification(notification));
        this.pruneIssueActionState();
        this.renderNotifications();
      } else {
        this.loadNotifications();
      }
    } catch (error) {
      console.error('Failed to refresh notifications:', error);
      this.loadNotifications();
    }
  }

  async clearAllNotifications() {
    const confirmed = confirm(this.translate('clearAllConfirmation'));
    if (!confirmed) return;
    
    try {
      const response = await this.sendRuntimeMessage({ 
        action: 'clearAllNotifications' 
      });
      
      if (response.success) {
        this.notifications = [];
        this.issueActionStates.clear();
        this.expandedNotificationId = undefined;
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

document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
