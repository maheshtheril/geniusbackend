// Minimal shims to compile without @types/* on Render
declare var process: any;

declare module 'express';
declare module 'cors';
declare module 'cookie-parser';
declare module 'pg';
declare module 'crypto';
