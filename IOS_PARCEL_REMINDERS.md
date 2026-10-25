# iOS parcel request reminders

The server checks for pending delivery requests every five seconds. It sends an
Apple-only reminder approximately every 25 seconds, for at most ten minutes from
the match's original creation time. The app's existing foreground player continues
to loop; when backgrounded or closed, iOS plays each reminder's bundled
`request_alert.caf` once. This is repeated notification audio, not continuous
background playback. The 20-second clip targets roughly a five-second pause.
The polling interval, network delivery, and iOS scheduling can vary the actual gap.

Before each send, the worker checks that the match is pending, the parcel is
pending, the trip is active, and the original notification recipient is the
traveler. It uses the traveler's current FCM token. No new notification history
records or Android-visible notifications are created.

The original push and reminders share one per-match APNs collapse ID and thread
ID. This asks iOS to replace the existing notification rather than add separate
cards for the same request. Each different match has its own identifier. Reminders
are titled "Pending delivery request" and explicitly refer to the existing
request. Old notifications delivered before this change may need to be cleared
manually; verify with a newly created request after deploying.

Withdrawal and expiry pushes replace that same card without a sound. Initial
parcel alerts also use APNs expiration zero so they cannot sit queued while the
device is offline. Whole-parcel cancellation notifies affected travelers, just
like cancelling an individual match. The original push rechecks the match before
sending, and the reminder worker rechecks it before each reminder.

The updated app closes its modal on cancellation from either sockets or push,
removes queued/closed requests, and validates iOS requests against the pending
matches API before showing them. A new app build is required for these client
changes. A notification sound already started by iOS can still finish its clip;
remote cancellation cannot guarantee interruption of that system-owned sound.

The original notification's metadata stores `_iosParcelReminderSlot`. An atomic
compare-and-set claims each interval once across server instances and restarts.
Missed intervals are skipped rather than replayed. Failed sends can try again at
the next interval. No database schema change is required.

Acceptance, rejection, cancellation, or the ten-minute deadline stops future
reminders. A notification already handed to APNs cannot be recalled, nor can the
server stop a sound already playing on a locked phone. Reminders use APNs expiry
zero to avoid queued delivery after reconnection, and a per-match collapse ID.

## Validate and deploy

Run `npm ci`, `npm run build`, then
`node --test tests/*.test.cjs`. Tests mock Firebase and the database;
they do not send notifications or read service-account secrets.

Deploy this backend revision to Render with build command `npm ci && npm run build`
and start command `npm start`. Keep the existing Firebase secret-file configuration.
The server must stay running: a Render service that sleeps or scales to zero cannot
run the reminder timer. On restart, only currently eligible requests are resumed.
The installed iOS app must already contain `request_alert.caf`.

On a real iPhone, create a request while locked and wait for the first reminder
(about 25–30 seconds). Wait for several reminders and verify the notification is
replaced, not duplicated. Accept/decline it and verify there are no subsequent sends.
Repeat with cancellation and with a request left pending past ten minutes.

Apple-only payloads follow Firebase's platform-specific message guidance:
https://firebase.google.com/docs/cloud-messaging/customize-messages/cross-platform
