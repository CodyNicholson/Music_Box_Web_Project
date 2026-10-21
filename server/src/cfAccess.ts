import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Normalises a team domain ("team", "team.cloudflareaccess.com" or a full URL) to its https origin. */
export function normaliseTeamDomain(teamDomain: string): string {
  let domain = teamDomain.trim();
  if (!domain) return '';
  if (!/^https?:\/\//.test(domain)) domain = `https://${domain}`;
  if (!domain.includes('.cloudflareaccess.com') && !domain.slice('https://'.length).includes('/')) {
    domain = `${domain}.cloudflareaccess.com`;
  }
  return domain.replace(/\/+$/, '');
}

/**
 * Verifies Cf-Access-Jwt-Assertion tokens against the team's public certs, policy audience and issuer.
 * Keys are fetched from <team>/cdn-cgi/access/certs, cached, and refetched when Cloudflare rotates them.
 */
export class CfAccessValidator {
  readonly teamDomain: string;
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    teamDomain: string,
    private readonly policyAud: string,
    opts: { certsUrl?: string; keys?: JWTVerifyGetKey } = {},
  ) {
    this.teamDomain = normaliseTeamDomain(teamDomain);
    if (!this.teamDomain) throw new Error('Cloudflare Access team domain is required');
    if (!policyAud.trim()) throw new Error('Cloudflare Access policy AUD is required');
    this.getKey = opts.keys ?? createRemoteJWKSet(new URL(opts.certsUrl || `${this.teamDomain}/cdn-cgi/access/certs`));
  }

  /** Returns the verified Google account email, lowercased. Throws if the token is invalid. */
  async verify(token: string): Promise<string> {
    const { payload } = await jwtVerify(token.trim(), this.getKey, {
      algorithms: ['RS256'],
      audience: this.policyAud.trim(),
      issuer: this.teamDomain,
      requiredClaims: ['exp'],
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email) throw new Error('token does not contain an email claim');
    return email;
  }
}
