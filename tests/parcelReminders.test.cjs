const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Neither production Firebase credentials nor a database are accessed by tests.
const firebasePath = require.resolve('../dist/utils/firebase');
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: {} };
const { sendDueParcelReminders } = require('../dist/utils/parcelReminders');

function fixture() {
  const start = Date.parse('2026-01-01T00:00:00Z');
  let time = start + 25_000;
  let status = 'PENDING';
  let parcelStatus = 'PENDING';
  let tripStatus = 'ACTIVE';
  let recipient = 'traveler';
  let token = 'test-token';
  let metadata = { matchId: 'match-1', parcelId: 'parcel-1' };
  let afterClaim;
  const sent = [];
  const prisma = {
    notification: {
      findMany: async () => [{ id: 'notification-1', userId: recipient, title: 'Request', body: 'Parcel',
        createdAt: new Date(start), metadata: { ...metadata } }],
      updateMany: async ({ where, data }) => {
        if (JSON.stringify(where.metadata.equals) !== JSON.stringify(metadata)) return { count: 0 };
        metadata = data.metadata;
        afterClaim?.();
        return { count: 1 };
      },
    },
    match: {
      findFirst: async ({ where }) => status === where.status
        && where.travelerId === 'traveler' && parcelStatus === where.parcel.status
        && tripStatus === where.trip.status && start > where.createdAt.gt.getTime()
        ? { createdAt: new Date(start), traveler: { fcmToken: token } } : null,
    },
  };
  return {
    sent, prisma, now: () => time,
    send: async (...args) => { sent.push(args); },
    advance: ms => { time += ms; },
    status: value => { status = value; },
    parcel: value => { parcelStatus = value; },
    trip: value => { tripStatus = value; },
    recipient: value => { recipient = value; },
    token: value => { token = value; },
    afterClaim: fn => { afterClaim = fn; },
    run() { return sendDueParcelReminders(prisma, this.send, this.now); },
  };
}

test('first reminder at 25 seconds, next at 50; no duplicate or catch-up burst', async () => {
  const f = fixture();
  f.advance(-1);
  await f.run();
  assert.equal(f.sent.length, 0);
  f.advance(1);
  await f.run();
  await f.run();
  assert.equal(f.sent.length, 1);
  f.advance(25_000);
  await f.run();
  assert.equal(f.sent.length, 2);
  f.advance(180_000);
  await f.run();
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent[0][3].createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(f.sent[0][3].notificationId, 'notification-1');
  assert.equal(f.sent[0][3]._iosParcelReminderSlot, undefined);
  assert.equal(f.sent[0][1], 'Pending delivery request');
  assert.match(f.sent[0][2], /existing parcel request/);
});

test('concurrent workers and a restarted worker claim an interval only once', async () => {
  const f = fixture();
  await Promise.all([f.run(), f.run()]);
  await sendDueParcelReminders(f.prisma, f.send, f.now);
  assert.equal(f.sent.length, 1);
});

for (const status of ['ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED']) {
  test(`no further reminders after ${status}`, async () => {
    const f = fixture();
    await f.run();
    f.status(status);
    f.advance(25_000);
    await f.run();
    assert.equal(f.sent.length, 1);
  });
}

test('expiry stops reminders even when the closed app has not called the expiry API', async () => {
  const f = fixture();
  f.advance(575_000);
  await f.run();
  assert.equal(f.sent.length, 0);
});

test('cancellation during the claim prevents sending', async () => {
  const f = fixture();
  f.afterClaim(() => f.status('CANCELLED'));
  await f.run();
  assert.equal(f.sent.length, 0);
});

test('cancelled parcel/trip, sender-initiated recipient mismatch, and missing token are skipped', async () => {
  for (const update of [f => f.parcel('CANCELLED'), f => f.trip('CANCELLED'),
    f => f.recipient('sender'), f => f.token(null)]) {
    const f = fixture();
    update(f);
    await f.run();
    assert.equal(f.sent.length, 0);
  }
});

test('failed send is not retried in a burst; later interval can try again', async () => {
  const f = fixture();
  let attempts = 0;
  f.send = async () => { attempts++; throw new Error('test transport failure'); };
  await f.run();
  await f.run();
  assert.equal(attempts, 1);
  f.advance(25_000);
  await f.run();
  assert.equal(attempts, 2);
});

test('reminder payload is Apple-only, uses CAF, and cannot queue stale offline alerts', async () => {
  const sent = [];
  const mockAdmin = {
    credential: { cert: () => ({}) }, initializeApp() {},
    messaging: () => ({ send: async message => { sent.push(message); } }),
  };
  const sandbox = {
    exports: {}, __dirname: path.dirname(firebasePath), process: { env: {} },
    console: { log() {}, error() {} },
    require: id => id === 'firebase-admin' ? mockAdmin : require(id),
  };
  vm.runInNewContext(fs.readFileSync(firebasePath, 'utf8'), sandbox);
  await sandbox.exports.sendIOSParcelReminder('test-token', 'Request', 'Parcel',
    { type: 'DELIVERY_REQUEST', matchId: 'match-1' }, 'match-1');
  const message = sent[0];
  assert.equal(message.notification, undefined);
  assert.equal(message.data, undefined);
  assert.equal(message.android, undefined);
  assert.equal(message.apns.payload.aps.sound, 'request_alert.caf');
  assert.equal(message.apns.payload.type, 'DELIVERY_REQUEST');
  assert.equal(message.apns.headers['apns-expiration'], '0');
  assert.equal(message.apns.headers['apns-collapse-id'], 'match_match-1');
});

test('original push and reminders replace one iOS card per match, with separate cards for different matches', async () => {
  const sent = [];
  const mockAdmin = {
    credential: { cert: () => ({}) }, initializeApp() {},
    messaging: () => ({ send: async message => { sent.push(message); return 'test-message'; } }),
  };
  const sandbox = {
    exports: {}, __dirname: path.dirname(firebasePath), process: { env: {} },
    console: { log() {}, error() {} },
    require: id => id === 'firebase-admin' ? mockAdmin : require(id),
  };
  vm.runInNewContext(fs.readFileSync(firebasePath, 'utf8'), sandbox);
  const data = { type: 'DELIVERY_REQUEST', matchId: 'match-1', notificationId: 'notification-1' };
  await sandbox.exports.sendPushNotification('test-token', 'Request', 'Parcel', data, 'request_alert.mp3', 'match_match-1');
  await sandbox.exports.sendIOSParcelReminder('test-token', 'Reminder', 'Existing parcel', data, 'match-1');
  await sandbox.exports.sendIOSParcelReminder('test-token', 'Reminder', 'Existing parcel', data, 'match-1');
  for (const message of sent) {
    assert.equal(message.apns.headers['apns-collapse-id'], 'match_match-1');
    assert.equal(message.apns.payload.aps.threadId, 'match_match-1');
    assert.equal(message.apns.payload.aps.sound, 'request_alert.caf');
  }
  assert.equal(sent[0].android.notification.tag, 'match_match-1');
  assert.equal(sent[0].android.collapseKey, 'match_match-1');
  assert.equal(sent[0].android.notification.sound, 'request_alert');
  assert.equal(sent[0].data.notificationId, 'notification-1');
  assert.equal(sent[1].apns.payload.notificationId, 'notification-1');
  await sandbox.exports.sendPushNotification('test-token', 'Request', 'Other parcel',
    { ...data, matchId: 'match-2' }, 'request_alert.mp3');
  assert.equal(sent[3].apns.headers['apns-collapse-id'], 'match_match-2');
  assert.notEqual(sent[3].apns.headers['apns-collapse-id'], sent[0].apns.headers['apns-collapse-id']);
  await sandbox.exports.sendPushNotification('test-token', 'Announcement', 'News', { type: 'GENERAL' });
  assert.equal(sent[4].apns.headers, undefined);
  assert.equal(sent[4].apns.payload.aps.threadId, undefined);
  assert.equal(sent[4].apns.payload.aps.sound, 'default');
});
