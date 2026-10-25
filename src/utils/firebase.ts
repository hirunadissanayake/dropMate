import * as admin from 'firebase-admin';
import path from 'path';

try {
    // Render can supply a fresh service-account JSON as a secret file.
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
        || path.join(__dirname, '../../serviceAccountKey.json');
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
    });
    
    console.log('✅ Firebase Admin initialized');
} catch (error) {
    console.error('❌ Error initializing Firebase Admin:', error);
}

const iosParcelNotificationId = (matchId: string) => `match_${matchId}`;

export const sendPushNotification = async (token: string, title: string, body: string, data?: any, sound?: string, tag?: string) => {
    try {
        // FCM 'data' field values must be strings
        const stringifiedData: { [key: string]: string } = {};
        if (data) {
            Object.keys(data).forEach(key => {
                stringifiedData[key] = String(data[key]);
            });
        }
        
        // Add standard click action for background handling
        stringifiedData.click_action = 'FLUTTER_NOTIFICATION_CLICK';

        const isParcelRequest = data?.type === 'DELIVERY_REQUEST' || data?.type === 'match_request';
        const iosParcelId = isParcelRequest && typeof data?.matchId === 'string'
            ? iosParcelNotificationId(data.matchId)
            : undefined;

        // Standard structure with top-level notification for reliability
        const message: any = {
            notification: {
                title,
                body,
            },
            data: stringifiedData,
            android: {
                priority: 'high',
                notification: {
                    channelId: sound ? 'delivery_requests' : 'standard_alerts',
                    // If it's an order request, use the custom sound. Otherwise, use 'default'.
                    sound: sound ? sound.replace('.mp3', '') : 'default',
                    tag: tag,
                },
            },
            apns: {
                // Use the same ID from the very first push through every reminder.
                // threadId groups cards; collapse ID replaces the existing card.
                ...(iosParcelId ? { headers: { 'apns-collapse-id': iosParcelId } } : {}),
                payload: {
                    aps: {
                        ...(iosParcelId ? { threadId: iosParcelId } : {}),
                        // iOS notification audio uses the bundled short CAF clip.
                        // Keep Android's MP3/raw resource name in android.notification.
                        sound: sound === 'request_alert.mp3'
                            ? 'request_alert.caf'
                            : (sound || 'default'),
                    },
                },
            },
            token: token,
        };

        if (tag) {
            message.android.collapseKey = tag;
        }

        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
        return response;
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};

// No top-level notification/data: only Apple devices receive a visible reminder.
// Android keeps the original delivery-request notification and alert behavior.
export const sendIOSParcelReminder = async (
    token: string, title: string, body: string, data: Record<string, unknown>, matchId: string,
) => {
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) payload[key] = String(value);
    return admin.messaging().send({
        token,
        apns: {
            headers: {
                'apns-push-type': 'alert',
                'apns-priority': '10',
                // Never queue reminders for delivery after a device reconnects.
                'apns-expiration': '0',
                'apns-collapse-id': iosParcelNotificationId(matchId),
            },
            payload: {
                ...payload,
                aps: {
                    alert: { title, body },
                    sound: 'request_alert.caf',
                    threadId: iosParcelNotificationId(matchId),
                },
            },
        },
    });
};

export default admin;
