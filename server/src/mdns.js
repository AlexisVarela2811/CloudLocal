/**
 * Bonjour/mDNS advertiser.
 * Announces CloudLocal on the local network as "cloudlocal.local".
 */

let bonjour = null;
let mdnsService = null;

/**
 * Start advertising CloudLocal on the LAN via mDNS/Bonjour.
 * Accessible at http://cloudlocal.local:<port>
 * @param {object} opts
 * @param {string} opts.name - Service name (default: 'cloudlocal')
 * @param {number} opts.port - HTTP port (default: 80)
 * @returns {object|null}
 */
function start(opts = {}) {
  const name = opts.name || 'cloudlocal';
  const port = opts.port || 80;

  try {
    const { Bonjour } = require('bonjour-service');
    bonjour = new Bonjour();

    // Use the correct bonjour-service v12+ API: publish()
    mdnsService = bonjour.publish({
      type: 'http',
      protocol: 'tcp',
      port: port,
      name: name,
      fqdn: `${name}._http._tcp.local`,
      txt: {
        desc: 'CloudLocal local file server',
        version: '1.0.0',
        platform: process.platform,
      },
    });

    mdnsService.on('up', () => {
      console.log(`[mDNS] CloudLocal is accessible at http://${name}.local:${port}`);
    });

    mdnsService.on('error', (err) => {
      console.warn(`[mDNS] Error: ${err.message}`);
    });

    return { bonjour, service: mdnsService };
  } catch (err) {
    console.warn(`[mDNS] Not available: ${err.message}`);
    return null;
  }
}

/**
 * Stop all mDNS services.
 */
function stop() {
  if (mdnsService) {
    try {
      mdnsService.stop();
    } catch (_) {}
    mdnsService = null;
  }
  if (bonjour) {
    try {
      bonjour.destroy();
    } catch (_) {}
    bonjour = null;
  }
}

module.exports = { start, stop };