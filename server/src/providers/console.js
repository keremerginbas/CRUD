// Geliştirme/test sağlayıcısı: SMS göndermez, sadece loglar.
function createConsoleProvider({ log = console.log } = {}) {
  let counter = 0;
  return {
    name: 'console',
    async send(phone, body) {
      counter += 1;
      log(`[SMS -> ${phone}] ${body}`);
      return { ref: `console-${Date.now()}-${counter}` };
    },
  };
}

module.exports = { createConsoleProvider };
