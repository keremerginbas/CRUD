const { createConsoleProvider } = require('./console');
const { createNetgsmProvider } = require('./netgsm');
const { createErccellProvider } = require('./erccell');

function createProviderFromEnv(env = process.env) {
  const name = env.SMS_PROVIDER || 'console';
  if (name === 'erccell') {
    return createErccellProvider({
      username: env.ERCCELL_USERNAME,
      password: env.ERCCELL_PASSWORD,
      header: env.ERCCELL_HEADER,
      smsType: env.ERCCELL_SMS_TYPE || 'UC',
    });
  }
  if (name === 'netgsm') {
    return createNetgsmProvider({
      usercode: env.NETGSM_USERCODE,
      password: env.NETGSM_PASSWORD,
      header: env.NETGSM_HEADER,
      iysFilter: env.NETGSM_IYS_FILTER ?? '11',
    });
  }
  if (name === 'console') return createConsoleProvider();
  throw new Error(`Bilinmeyen SMS_PROVIDER: ${name}`);
}

module.exports = { createProviderFromEnv };
