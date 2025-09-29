export const handler = async (event) => {
  try {
    const triggerSource = event.triggerSource;
    const email = event?.request?.userAttributes?.email || '';
    const appName = process.env.APP_NAME || 'Motion';

    if (triggerSource === 'CustomMessage_SignUp') {
      const code = event.request.codeParameter || '{####}';
      event.response.emailSubject = 'Verify Your New Account';
      event.response.emailMessage = `Hi ${email || 'there'},

Welcome to ${appName}!

To finish setting up your account, enter the verification code below:

${code}

If you didn't request this account, you can ignore this email.

Thanks,
${appName} Support`;
    } else if (triggerSource === 'CustomMessage_ForgotPassword') {
      const code = event.request.codeParameter || '{####}';
      event.response.emailSubject = 'Verify Your Password Change Request';
      event.response.emailMessage = `Hi ${email || 'there'},

We received a request to change the password for your ${appName} account.

Your verification code is: ${code}

If you didn't request a password change, you can ignore this email. Your password will remain the same.

Thanks,
${appName} Support`;
    }

    return event;
  } catch (err) {
    console.error('Custom message handler error', err);
    return event;
  }
};
