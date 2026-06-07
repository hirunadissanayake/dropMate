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
                    channelId: 'delivery_requests',
                    sound: sound ? sound.replace('.mp3', '') : 'default',
                    tag: tag,
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: sound ? (sound.endsWith('.mp3') ? sound : `${sound}.mp3`) : (tag ? undefined : 'default'),
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

export default admin;
