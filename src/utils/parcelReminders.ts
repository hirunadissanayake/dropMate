import { Prisma, PrismaClient } from '@prisma/client';
import { sendIOSParcelReminder } from './firebase';

export const REMINDER_INTERVAL_MS = 30_000;
export const REQUEST_WINDOW_MS = 10 * 60_000;
const SLOT_KEY = '_iosParcelReminderSlot';

type ReminderSender = typeof sendIOSParcelReminder;

// Persist the claimed interval in the existing notification metadata. An atomic
// compare-and-set prevents duplicate sends across workers and server restarts.
// Claim before sending: after a crash, skip that interval rather than ring twice.
export async function sendDueParcelReminders(
  prisma: PrismaClient,
  send: ReminderSender = sendIOSParcelReminder,
  now: () => number = Date.now,
) {
  const scanTime = now();
  let cursor: string | undefined;
  for (;;) {
    const notifications = await prisma.notification.findMany({
      where: {
        type: 'DELIVERY_REQUEST',
        createdAt: { gt: new Date(scanTime - REQUEST_WINDOW_MS), lte: new Date(scanTime) },
      },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const notification of notifications) {
      try {
        const metadata = notification.metadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
        const matchId = metadata.matchId;
        if (typeof matchId !== 'string') continue;

        const eligibleMatch = () => prisma.match.findFirst({
          where: {
            id: matchId,
            status: 'PENDING',
            // Only remind the traveler receiving a request, never the initiator.
            travelerId: notification.userId,
            createdAt: { gt: new Date(now() - REQUEST_WINDOW_MS) },
            parcel: { status: 'PENDING' },
            trip: { status: 'ACTIVE' },
          },
          select: { createdAt: true, traveler: { select: { fcmToken: true } } },
        });
        const match = await eligibleMatch();
        if (!match?.traveler.fcmToken) continue;
        const slot = Math.floor((now() - match.createdAt.getTime()) / REMINDER_INTERVAL_MS);
        if (slot < 1 || slot >= REQUEST_WINDOW_MS / REMINDER_INTERVAL_MS) continue;
        if (typeof metadata[SLOT_KEY] === 'number' && metadata[SLOT_KEY] >= slot) continue;

        const claim = await prisma.notification.updateMany({
          where: { id: notification.id, metadata: { equals: metadata as Prisma.InputJsonObject } },
          data: { metadata: { ...metadata, [SLOT_KEY]: slot } as Prisma.InputJsonObject },
        });
        if (claim.count !== 1) continue;
        // Status or token may have changed while this worker claimed the slot.
        const current = await eligibleMatch();
        if (!current?.traveler.fcmToken) continue;
        const { [SLOT_KEY]: ignored, ...data } = metadata;
        await send(current.traveler.fcmToken, notification.title, notification.body, {
          ...data,
          type: 'DELIVERY_REQUEST',
          notificationId: notification.id,
          createdAt: current.createdAt.toISOString(),
          reminder: 'true',
        }, matchId);
      } catch (error) {
        // Do not log credentials, tokens, or notification contents.
        console.error('Parcel reminder failed:', error instanceof Error ? error.name : 'UnknownError');
      }
    }
    if (notifications.length < 100) return;
    cursor = notifications[notifications.length - 1].id;
  }
}

export function startParcelReminders(prisma: PrismaClient) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendDueParcelReminders(prisma);
    } catch {
      console.error('Parcel reminder scan failed; will retry on the next interval');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, 5_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
