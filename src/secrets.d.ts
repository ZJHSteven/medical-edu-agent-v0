// Worker Secrets 不会由 `wrangler types` 自动写入业务自定义声明；
// 这里仅声明变量名，实际值只来自 `.env.local`（本地）或 Wrangler Secret（线上）。
declare namespace Cloudflare {
  interface Env {
    AUTH_SECRET: string;

    HEYIWEI_G2_KEY: string;
    HEYIWEI_G9_KEY: string;
    HEYIWEI_G13_KEY: string;
    HEYIWEI_G35_KEY: string;
    HEYIWEI_G39_KEY: string;
    HEYIWEI_G42_KEY: string;
    HEYIWEI_CONSOLE_REFRESH_TOKEN: string;

    HAIBAO_G2_KEY: string;
    HAIBAO_G19_KEY: string;

    DEEPSEEK_API_KEY: string;
  }
}

interface Env {
  AUTH_SECRET: string;

  HEYIWEI_G2_KEY: string;
  HEYIWEI_G9_KEY: string;
  HEYIWEI_G13_KEY: string;
  HEYIWEI_G35_KEY: string;
  HEYIWEI_G39_KEY: string;
  HEYIWEI_G42_KEY: string;
  HEYIWEI_CONSOLE_REFRESH_TOKEN: string;

  HAIBAO_G2_KEY: string;
  HAIBAO_G19_KEY: string;

  DEEPSEEK_API_KEY: string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    AUTH_SECRET: string;

    HEYIWEI_G2_KEY: string;
    HEYIWEI_G9_KEY: string;
    HEYIWEI_G13_KEY: string;
    HEYIWEI_G35_KEY: string;
    HEYIWEI_G39_KEY: string;
    HEYIWEI_G42_KEY: string;
    HEYIWEI_CONSOLE_REFRESH_TOKEN: string;

    HAIBAO_G2_KEY: string;
    HAIBAO_G19_KEY: string;

    DEEPSEEK_API_KEY: string;
  }
}
