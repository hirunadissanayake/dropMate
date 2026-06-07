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

        // Standard structure without top-level notification to prevent "double" behavior on some devices
        const message: any = {
            data: stringifiedData,
            token: token,
        };

        if (tag) {
            message.collapseKey = tag; // Group messages in FCM queue
        }

        // Android specific options
        message.android = {
            priority: 'high',
            collapseKey: tag, // Use collapse_key here as well for Android
            notification: {
                title, 
                body,  
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                channelId: 'delivery_requests',
                tag: tag, 
                ticker: title,
                sticky: false,
                visibility: 'public',
            },
            data: stringifiedData // Duplicate data here for some Android versions
        };

        if (sound) {
            message.android.notification.sound = sound.replace('.mp3', '');
        } else if (tag) {
            // Force a different channel for cancellations to try and break the ringtone
            // message.android.notification.channelId = 'default'; 
            message.android.notification.sound = 'default'; 
        }

        // iOS specific options
        message.apns = {
            payload: {
                aps: {
                    alert: {
                        title,
                        body,
                    },
                    sound: sound ? (sound.endsWith('.mp3') ? sound : `${sound}.mp3`) : (tag ? undefined : 'default'),
                }
            }
        };

        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
        return response;
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};

export default admin;
