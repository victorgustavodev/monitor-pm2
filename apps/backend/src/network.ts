import type { NextFunction, Request, Response } from 'express';
import ipaddr from 'ipaddr.js';
import { env } from './config';
import { HttpError } from './http-error';

const ranges = env.vpnAllowedCidrs === '*' ? null : env.vpnAllowedCidrs.split(',').map((cidr) => {
  try {
    return ipaddr.parseCIDR(cidr.trim());
  } catch {
    throw new Error(`CIDR inválido em VPN_ALLOWED_CIDRS: ${cidr}`);
  }
});

export function networkOnly(request: Request, _response: Response, next: NextFunction) {
  if (!ranges) return next();
  try {
    const address = ipaddr.process(request.socket.remoteAddress ?? '');
    const allowed = ranges.some(([network, prefix]) =>
      address.kind() === network.kind() && address.match(network, prefix),
    );
    if (allowed) return next();
  } catch {
    // Um endereço inválido nunca recebe acesso.
  }
  next(new HttpError(403, 'Acesso permitido apenas pela rede corporativa.'));
}
