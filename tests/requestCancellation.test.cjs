const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModule(filename, dependencies) {
  const resolved = path.resolve(__dirname, '../dist', filename);
  const sandbox = {exports: {}, __dirname: path.dirname(resolved),
    console: {log() {}, error() {}}, process: {env: {}},
    require: id => {
      if (id in dependencies) return dependencies[id];
      if (id === 'path') return path;
      throw new Error(`Unexpected test dependency: ${id}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(resolved, 'utf8'), sandbox);
  return sandbox.exports;
}

function response() {
  return {code: 200, status(code) {this.code = code; return this;}, json(value) {this.body = value; return this;}};
}

test('withdrawal silently replaces the parcel notification; original alerts cannot queue offline', async () => {
  const sent = [];
  const firebase = loadModule('utils/firebase.js', {'firebase-admin': {
    credential: {cert: () => ({})}, initializeApp() {},
    messaging: () => ({send: async message => sent.push(message)}),
  }});
  await firebase.sendPushNotification('test-token', 'Request', 'Parcel',
    {type: 'DELIVERY_REQUEST', matchId: 'match-1'}, 'request_alert.mp3');
  await firebase.sendPushNotification('test-token', 'Withdrawn', 'Withdrawn',
    {type: 'MATCH_CANCELLED', matchId: 'match-1'});
  assert.equal(sent[0].apns.headers['apns-expiration'], '0');
  assert.equal(sent[1].apns.headers['apns-collapse-id'], sent[0].apns.headers['apns-collapse-id']);
  assert.equal(sent[1].apns.payload.aps.sound, undefined);
  assert.equal(sent[1].apns.payload.aps.contentAvailable, true);
  assert.equal(sent[1].android.notification.sound, 'default');
});

test('withdrawing a match commits cancellation before socket and push notifications', async () => {
  let status = 'PENDING';
  const events = [], notices = [];
  const prisma = {match: {
    findUnique: async () => ({id: 'match-1', senderId: 'sender', travelerId: 'traveler', status, parcel: {name: 'Box'}}),
    updateMany: async ({where, data}) => {
      assert.equal(where.status, 'PENDING'); status = data.status; return {count: 1};
    },
  }};
  const controller = loadModule('controllers/deliveryController.js', {
    '@prisma/client': {PrismaClient: function() {return prisma;}},
    '../utils/otpUtils': {},
    './notificationController': {createNotification: async notice => {assert.equal(status, 'CANCELLED'); notices.push(notice);}},
    '../index': {io: {to: user => ({emit: (type, data) => {assert.equal(status, 'CANCELLED'); events.push({user, type, data});}})}},
  });
  const res = response();
  await controller.cancelMatch({params: {id: 'match-1'}, user: {id: 'sender'}}, res);
  assert.equal(res.code, 200);
  assert.equal(events[0].type, 'request_cancelled');
  assert.equal(events[0].user, 'traveler');
  assert.equal(notices[0].type, 'MATCH_CANCELLED');
  assert.equal(notices[0].metadata.matchId, 'match-1');
});

test('cancelling a whole parcel closes its pending matches and notifies each traveler', async () => {
  let parcelStatus = 'PENDING', matchStatus = 'PENDING';
  const events = [], notices = [];
  const prisma = {
    parcel: {
      findUnique: async () => ({senderId: 'sender', status: parcelStatus, name: 'Box'}),
      update: async () => {parcelStatus = 'CANCELLED';},
    },
    match: {
      findMany: async () => [{id: 'match-1', travelerId: 'traveler'}],
      updateMany: async () => {matchStatus = 'CANCELLED'; return {count: 1};},
    },
    $transaction: async callback => callback(prisma),
  };
  const controller = loadModule('controllers/parcelController.js', {
    '@prisma/client': {PrismaClient: function() {return prisma;}},
    '../utils/priceCalculator': {}, '../utils/notificationHelpers': {},
    './notificationController': {createNotification: async notice => {
      assert.equal(parcelStatus, 'CANCELLED'); assert.equal(matchStatus, 'CANCELLED'); notices.push(notice);
    }},
    '../index': {io: {to: user => ({emit: (type, data) => events.push({user, type, data})})}},
  });
  const res = response();
  await controller.cancelParcel({params: {id: 'parcel-1'}, user: {id: 'sender'}}, res);
  assert.equal(res.code, 200);
  assert.equal(events[0].type, 'request_cancelled');
  assert.equal(notices[0].metadata.matchId, 'match-1');
  assert.equal(notices[0].userId, 'traveler');
});

test('original delivery alert is skipped if withdrawal happens before the push is sent', async () => {
  const pushes = [];
  const prisma = {
    notification: {create: async () => ({id: 'notice-1'})},
    user: {findUnique: async () => ({fcmToken: 'test-token'})},
    match: {findFirst: async () => null},
  };
  const controller = loadModule('controllers/notificationController.js', {
    '@prisma/client': {PrismaClient: function() {return prisma;}},
    '../index': {io: {to: () => ({emit() {}})}},
    '../utils/firebase': {sendPushNotification: async (...args) => pushes.push(args)},
  });
  await controller.createNotification({userId: 'traveler', type: 'DELIVERY_REQUEST',
    title: 'Request', body: 'Box', metadata: {matchId: 'closed'}});
  assert.equal(pushes.length, 0);
});
