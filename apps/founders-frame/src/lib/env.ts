const isProd = process.env.NODE_ENV === 'production';

export const env = {
  NEXT_PUBLIC_WALLET_APP_URL:
    process.env.NEXT_PUBLIC_WALLET_APP_URL ||
    process.env.NEXT_PUBLIC_WALLET_URL ||
    (isProd ? 'https://myframecredits.app' : 'http://localhost:3001'),
  NEXT_PUBLIC_ROUGH_CUT_APP_URL:
    process.env.NEXT_PUBLIC_ROUGH_CUT_APP_URL ||
    process.env.NEXT_PUBLIC_ROUGH_CUT_URL ||
    (isProd ? 'https://myfirstcut.app' : 'http://localhost:3000'),
};
