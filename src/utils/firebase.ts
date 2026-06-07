import * as admin from 'firebase-admin';
import path from 'path';

try {
    const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
    });
    
    console.log('✅ Firebase Admin initialized');
} catch (error) {
    console.error('❌ Error initializing Firebase Admin:', error);
}

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

        const message: any = {
            notification: {
                title,
                body,
            },
            data: stringifiedData,
            token: token,
        };

        // Android specific options
        message.android = {
            priority: 'high', // Both must be high to override properly
            notification: {
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                channelId: 'delivery_requests', // MUST match for both to let tag overwrite work
                ticker: title,
                sticky: false,
                visibility: 'public',
            }
        };

        if (tag) {
            message.android.notification.tag = tag;
        }

        if (sound) {
            // Android sound (no extension)
            message.android.notification.sound = sound.replace('.mp3', '');
        } else if (tag) {
            // FORCE DEFAULT SOUND (to stop custom looping sound from previous notification)
            message.android.notification.sound = 'default';
        }

        if (sound || tag) {
            // iOS sound (with extension)
            message.apns = {
                payload: {
                    aps: {
                        sound: sound ? (sound.endsWith('.mp3') ? sound : `${sound}.mp3`) : (tag ? 'default' : 'default'),
                    }
                }
            };
        }

        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
        return response;
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};

export default admin;
