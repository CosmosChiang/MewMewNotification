const policy = require('./notification-policy.js');

describe('notification policy', () => {
  test('normalizes snapshots and builds tracked field changes', () => {
    expect(policy.normalizeIssueSnapshot(null)).toBeUndefined();
    expect(policy.normalizeChangeSummary('invalid')).toEqual([]);
    const previous = {
      subject: 'Old',
      status: 'New',
      priority: 'Normal',
      assigneeId: 1,
      assigneeName: 'A',
      updatedOn: 1
    };
    const current = {
      subject: 'New',
      status: 'Closed',
      priority: 'High',
      assigneeId: 2,
      assigneeName: 'B',
      updatedOn: 2
    };
    expect(policy.buildChangeSummary(previous, current)).toEqual([
      { field: 'subject', from: 'Old', to: 'New' },
      { field: 'status', from: 'New', to: 'Closed' },
      { field: 'priority', from: 'Normal', to: 'High' },
      { field: 'assignee', from: 'A', to: 'B' }
    ]);
    expect(policy.snapshotIssue({
      subject: 'Issue',
      status: { name: 'Open' },
      priority: { name: 'Normal' },
      assigned_to: { id: 1, name: 'A' },
      updated_on: '2026-07-17T00:00:00.000Z'
    })).toEqual(expect.objectContaining({
      subject: 'Issue',
      status: 'Open',
      assigneeId: 1
    }));
  });

  test('classifies comments, tracked changes, and generic updates', () => {
    expect(policy.hasExplicitCommentActivity({ notes: 'hello' })).toBe(true);
    expect(policy.hasExplicitCommentActivity({ journals: [{ notes: 'journal' }] })).toBe(true);
    expect(policy.hasExplicitCommentActivity({ journals: [] })).toBe(false);
    expect(policy.classifyIssueUpdate(
      { status: 'New' },
      { status: 'Closed' },
      { notes: 'done' }
    )).toEqual(['status', 'comment']);
    expect(policy.classifyIssueUpdate({}, {}, {})).toEqual(['generic']);
  });

  test('evaluates include and exclude project rules', () => {
    expect(policy.isProjectEligible(2, { mode: 'include', includeProjectIds: [2] })).toBe(true);
    expect(policy.isProjectEligible(3, { mode: 'include', includeProjectIds: [2] })).toBe(false);
    expect(policy.isProjectEligible(2, { mode: 'exclude', excludeProjectIds: [2] })).toBe(false);
    expect(policy.isProjectEligible(undefined, { mode: 'exclude', excludeProjectIds: [2] })).toBe(true);
    expect(policy.isProjectEligible(2, { mode: 'all' })).toBe(true);
  });

  test('evaluates daytime and overnight quiet hours', () => {
    expect(policy.isWithinQuietHours(new Date(2026, 0, 1, 12, 0), {
      enabled: true,
      start: '09:00',
      end: '17:00'
    })).toBe(true);
    expect(policy.isWithinQuietHours(new Date(2026, 0, 1, 18, 0), {
      enabled: true,
      start: '09:00',
      end: '17:00'
    })).toBe(false);
    expect(policy.isWithinQuietHours(new Date(2026, 0, 1, 23, 0), {
      enabled: true,
      start: '22:00',
      end: '08:00'
    })).toBe(true);
    expect(policy.isWithinQuietHours(new Date(), { enabled: false })).toBe(false);
    expect(policy.isWithinQuietHours(new Date(), {
      enabled: true,
      start: '09:00',
      end: '09:00'
    })).toBe(false);
  });

  test('finds only valid in-window bundling targets', () => {
    const notifications = [{
      issueId: 7,
      updatedOn: new Date('2026-07-17T00:00:00.000Z')
    }];
    expect(policy.findBundlingTarget(
      notifications,
      7,
      '2026-07-17T00:04:00.000Z',
      { enabled: true, windowMinutes: 5 }
    )).toBe(notifications[0]);
    expect(policy.findBundlingTarget(
      notifications,
      7,
      '2026-07-17T00:10:00.000Z',
      { enabled: true, windowMinutes: 5 }
    )).toBeUndefined();
    expect(policy.findBundlingTarget(notifications, 7, 'invalid', {
      enabled: true,
      windowMinutes: 5
    })).toBeUndefined();
    expect(policy.findBundlingTarget(notifications, 7, new Date(), {
      enabled: false,
      windowMinutes: 5
    })).toBeUndefined();
  });
});
