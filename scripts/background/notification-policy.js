(function initializeNotificationPolicy(root, factory) {
  const policy = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = policy;
  } else {
    root.NotificationPolicy = policy;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNotificationPolicy() {
  function normalizeChangeSummary(changeSummary) {
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

  function normalizeIssueSnapshot(snapshot) {
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

  function snapshotIssue(issue) {
    return normalizeIssueSnapshot({
      subject: issue?.subject,
      status: issue?.status?.name,
      priority: issue?.priority?.name,
      assigneeId: issue?.assigned_to?.id,
      assigneeName: issue?.assigned_to?.name,
      updatedOn: new Date(issue?.updated_on).getTime()
    });
  }

  function buildChangeSummary(previousState, currentState) {
    const previous = normalizeIssueSnapshot(previousState);
    const current = normalizeIssueSnapshot(currentState);
    if (!previous || !current) {
      return [];
    }

    const changes = [];
    for (const field of ['subject', 'status', 'priority']) {
      if ((previous[field] || '') !== (current[field] || '')) {
        changes.push({ field, from: previous[field] || '', to: current[field] || '' });
      }
    }
    if (previous.assigneeId !== current.assigneeId || previous.assigneeName !== current.assigneeName) {
      changes.push({
        field: 'assignee',
        from: previous.assigneeName,
        to: current.assigneeName
      });
    }
    return changes;
  }

  function hasExplicitCommentActivity(issue) {
    if (!issue || typeof issue !== 'object') {
      return false;
    }
    const directFields = ['notes', 'last_notes', 'lastNotes', 'journalNotes', 'lastJournalNotes'];
    if (directFields.some(field => typeof issue[field] === 'string' && issue[field].trim())) {
      return true;
    }
    return Array.isArray(issue.journals) && issue.journals.some(journal => (
      journal
      && typeof journal === 'object'
      && typeof journal.notes === 'string'
      && journal.notes.trim()
    ));
  }

  function classifyIssueUpdate(previousState, currentState, issue) {
    const categories = new Set();
    buildChangeSummary(previousState, currentState).forEach(change => {
      if (['status', 'assignee', 'priority'].includes(change.field)) {
        categories.add(change.field);
      }
    });
    if (hasExplicitCommentActivity(issue)) {
      categories.add('comment');
    }
    if (categories.size === 0) {
      categories.add('generic');
    }
    return Array.from(categories);
  }

  function isProjectEligible(projectId, rules = { mode: 'all' }) {
    const normalizedProjectId = Number.parseInt(projectId, 10);
    const hasProjectId = Number.isSafeInteger(normalizedProjectId) && normalizedProjectId > 0;
    if (rules.mode === 'include') {
      return hasProjectId && (rules.includeProjectIds || []).includes(normalizedProjectId);
    }
    if (rules.mode === 'exclude') {
      return !hasProjectId || !(rules.excludeProjectIds || []).includes(normalizedProjectId);
    }
    return true;
  }

  function isWithinQuietHours(referenceTime, quietHours = { enabled: false }) {
    if (!quietHours.enabled) {
      return false;
    }
    const [startHour, startMinute] = quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = quietHours.end.split(':').map(Number);
    const start = (startHour * 60) + startMinute;
    const end = (endHour * 60) + endMinute;
    const current = (referenceTime.getHours() * 60) + referenceTime.getMinutes();
    if (start === end) {
      return false;
    }
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  function findBundlingTarget(notifications, issueId, updatedOn, bundling) {
    if (!bundling?.enabled) {
      return undefined;
    }
    const updatedTimestamp = updatedOn instanceof Date ? updatedOn.getTime() : new Date(updatedOn).getTime();
    if (!Number.isFinite(updatedTimestamp)) {
      return undefined;
    }
    const windowMs = bundling.windowMinutes * 60 * 1000;
    return notifications.find(notification => {
      const timestamp = notification.updatedOn instanceof Date
        ? notification.updatedOn.getTime()
        : new Date(notification.updatedOn).getTime();
      return notification.issueId === Number(issueId)
        && Number.isFinite(timestamp)
        && updatedTimestamp >= timestamp
        && updatedTimestamp - timestamp <= windowMs;
    });
  }

  return Object.freeze({
    normalizeChangeSummary,
    normalizeIssueSnapshot,
    snapshotIssue,
    buildChangeSummary,
    hasExplicitCommentActivity,
    classifyIssueUpdate,
    isProjectEligible,
    isWithinQuietHours,
    findBundlingTarget
  });
});
