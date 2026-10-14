const { createConsoleProvider } = require('./console');
const { createNetgsmProvider } = require('./netgsm');

function createProviderFromEnv(env = process.env) {
  const name = env.SMS_PROVIDER || 'console';
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
