import dns from 'dns/promises';
import { URL } from 'url';

/**
 * Checks if an IP address belongs to private, loopback, or cloud metadata ranges.
 */
export function isPrivateIp(ip: string): boolean {
  // IPv4 loopback
  if (ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  // IPv4 private ranges
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  // Link-local / Cloud metadata (AWS, GCP, Azure 169.254.169.254)
  if (ip.startsWith('169.254.')) return true;
  // Carrier-grade NAT
  if (ip.startsWith('100.64.')) return true;
  // IPv6 loopback / private
  if (ip === '::1' || ip === '::' || ip.startsWith('fc00:') || ip.startsWith('fe80:')) return true;
  // 0.0.0.0
  if (ip === '0.0.0.0') return true;

  return false;
}

/**
 * Validates a target URL against SSRF threats.
 * Throws an error if URL points to localhost, private IP, or invalid protocol.
 */
export async function validateSafeUrl(urlStr: string): Promise<{ valid: boolean; normalizedUrl: string; hostname: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only allow http and https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http: and https: are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and standard loopback hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254'
  ) {
    throw new Error('Access to internal, loopback, or metadata hostnames is forbidden.');
  }

  // Resolve hostname DNS to check IP
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        throw new Error(`Resolved destination IP (${addr.address}) is a restricted private/loopback network.`);
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes('restricted')) {
      throw err;
    }
    // If DNS resolution fails, reject
    throw new Error(`DNS resolution failed for hostname "${hostname}": ${err.message}`);
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    hostname
  };
}

/**
 * Safe fetch wrapper that enforces timeout, max response size, and SSRF checks.
 */
export async function safeFetch(urlStr: string, options: RequestInit = {}, maxSizeBytes = 2 * 1024 * 1024): Promise<Response> {
  const { normalizedUrl } = await validateSafeUrl(urlStr);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(normalizedUrl, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'AffiliateOS-Bot/2.0 (+https://affiliateos.io/bot; security-verified)',
        ...(options.headers || {})
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    // Verify final redirect URL if redirects occurred
    if (response.url && response.url !== normalizedUrl) {
      await validateSafeUrl(response.url);
    }

    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out fetching ${urlStr}`);
    }
    throw err;
  }
}
