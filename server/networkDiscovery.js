const { exec } = require('child_process');
const net = require('net');
const os = require('os');

const COMMON_HTTP_PORTS = [80, 443, 8080, 8443, 3000, 3001, 5000, 8000, 8888, 9000, 9443];
const PROBE_TIMEOUT_MS = 800;
const PING_TIMEOUT_MS = 500;
const MAX_HOSTS_TO_SCAN = 50;

function getLocalSubnets() {
  const ifaces = os.networkInterfaces();
  const subnets = [];
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        subnets.push({ ip: addr.address, prefix: addr.cidr });
      }
    }
  }
  return subnets;
}

function subnetToRange(cidr) {
  try {
    const [base, bits] = cidr.split('/');
    const prefixLen = parseInt(bits);
    if (prefixLen < 16 || prefixLen > 30) return [];
    const parts = base.split('.').map(Number);
    const hostBits = 32 - prefixLen;
    const totalHosts = Math.min(Math.pow(2, hostBits) - 2, MAX_HOSTS_TO_SCAN);
    const baseNum = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    const networkNum = baseNum & (~0 << hostBits);
    const ips = [];
    for (let i = 1; i <= totalHosts; i++) {
      const n = networkNum + i;
      ips.push(`${(n >> 24) & 255}.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`);
    }
    return ips;
  } catch {
    return [];
  }
}

function pingHost(ip) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'darwin'
      ? `ping -c 1 -W ${PING_TIMEOUT_MS} ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    exec(cmd, { timeout: PING_TIMEOUT_MS + 500 }, (err) => resolve(!err));
  });
}

function probePort(ip, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    sock.setTimeout(PROBE_TIMEOUT_MS);
    sock.on('connect', () => { done = true; sock.destroy(); resolve(true); });
    sock.on('timeout', () => { if (!done) { done = true; sock.destroy(); resolve(false); } });
    sock.on('error', () => { if (!done) { done = true; resolve(false); } });
    try { sock.connect(port, ip); } catch { resolve(false); }
  });
}

async function probeHost(ip) {
  const openPorts = [];
  await Promise.all(
    COMMON_HTTP_PORTS.map(async (port) => {
      if (await probePort(ip, port)) openPorts.push(port);
    })
  );
  return openPorts;
}

function inferServiceType(ip, openPorts) {
  if (openPorts.includes(443) || openPorts.includes(8443) || openPorts.includes(9443)) {
    return { type: 'https', port: openPorts.find(p => [443, 8443, 9443].includes(p)), scheme: 'https' };
  }
  if (openPorts.length > 0) {
    const p = openPorts[0];
    return { type: 'http', port: p, scheme: 'http' };
  }
  return null;
}

async function getArpHosts() {
  return new Promise((resolve) => {
    exec('arp -a', { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve([]);
      const hosts = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
        if (match && !line.includes('incomplete')) {
          const name = line.match(/^(\S+)/)?.[1];
          hosts.push({ ip: match[1], hostname: name && name !== '?' ? name : null });
        }
      }
      resolve(hosts);
    });
  });
}

async function discoverNetwork(customSubnet = null) {
  const arpHosts = await getArpHosts();
  const arpIps = new Set(arpHosts.map(h => h.ip));

  const allIps = new Map();

  if (customSubnet) {
    // Scan the user-specified subnet only (no ARP seeding, still probe all IPs in range)
    const range = subnetToRange(customSubnet);
    for (const ip of range) allIps.set(ip, { ip, hostname: null });
    // Supplement with ARP hostnames for any IPs that happen to be in the ARP table
    for (const h of arpHosts) {
      if (allIps.has(h.ip) && h.hostname) allIps.get(h.ip).hostname = h.hostname;
    }
  } else {
    // Auto-detect: ARP table + all local subnets
    for (const h of arpHosts) allIps.set(h.ip, { ip: h.ip, hostname: h.hostname });
    for (const subnet of getLocalSubnets()) {
      if (!subnet.prefix) continue;
      const range = subnetToRange(subnet.prefix);
      for (const ip of range) {
        if (!allIps.has(ip)) allIps.set(ip, { ip, hostname: null });
      }
    }
  }

  // Ping all IPs in parallel (skip ones already in ARP — they're reachable by definition)
  const candidates = [...allIps.values()];
  const pingResults = await Promise.all(
    candidates.map(async (host) => {
      const alive = arpIps.has(host.ip) || await pingHost(host.ip);
      return { ...host, alive };
    })
  );

  const alive = pingResults.filter(h => h.alive);

  // Probe open HTTP ports on alive hosts
  const results = await Promise.all(
    alive.map(async (host) => {
      const openPorts = await probeHost(host.ip);
      const service = inferServiceType(host.ip, openPorts);
      return {
        ip: host.ip,
        hostname: host.hostname,
        openPorts,
        service,
        suggestedUrl: service ? `${service.scheme}://${host.ip}${service.port !== 80 && service.port !== 443 ? ':' + service.port : ''}` : null,
        suggestedType: service ? service.type : 'icmp',
      };
    })
  );

  // Sort: HTTP-accessible hosts first, then by IP
  return results.sort((a, b) => {
    const aHttp = a.openPorts.length > 0 ? 0 : 1;
    const bHttp = b.openPorts.length > 0 ? 0 : 1;
    if (aHttp !== bHttp) return aHttp - bHttp;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });
}

module.exports = { discoverNetwork, getLocalSubnets };
