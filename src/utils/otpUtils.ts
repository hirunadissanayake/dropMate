import crypto from 'crypto';

export const generateOtp = (): string => {
  // Generates a 6-digit numeric OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sendSms = async (phone: string, message: string) => {
  // In production, you would use an SMS Gateway API like Twilio or an SL Gateway
  console.log(`[SMS-SIMULATOR] To: ${phone} | Message: ${message}`);
  return true;
};
