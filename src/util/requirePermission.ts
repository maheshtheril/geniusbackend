export function requirePermission(...need: string[]) {
  return (req: any, res: any, next: any) => {
    const perms: string[] = req.auth?.permissions || [];
    if (perms.includes('*')) return next();
    const ok = need.every(n => perms.includes(n) || perms.includes(n.split(':')[0] + ':*'));
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
